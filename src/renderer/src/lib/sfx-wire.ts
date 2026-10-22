/**
 * 音效的**接线**：把 `sfx.ts` 里那些音接到界面动作上。
 *
 * 【为什么"怎么触发"要独立成一个模块】
 * `sfx.ts` 回答的是「这个音长什么样」，本模块回答的是「什么时候响」。
 * 两件事的改动频率完全不同——换素材不该动触发逻辑，加一条触发不该碰播放代码。
 *
 * 本模块还多担了一件事：**把 `assets/sounds/` 里的文件登记进播放引擎**
 * （`loadSfxAssets()`）。之所以放在这里而不是 `sfx.ts`：glob 和 `document` 一样
 * 是"进不了单测"的东西，而 `sfx.ts` 要保住可测性。
 *
 * 【为什么"普通点击"用事件委托，而不是给每个组件加一句 playSfx】
 * 界面里的可点元素有两类：
 *   1. **语义化的**（`<button>`、`<a>`、`<summary>`、`[role=button]`）——
 *      这类用一条委托规则全覆盖，一行不用改；
 *   2. **自己画出来的**（侧栏的课程行、阶段小方块这些 `<div @click>`）——
 *      这类没有语义可依，靠 `data-sfx` 属性自己表态。
 * 如果反过来做（每个调用点手写一句），那么**新加一个按钮时默认就是静音的**——
 * 而这种漏法不会报错、不会崩溃，只是"这个按钮点了没声"，几乎不可能被发现。
 * 委托的默认值是"有声"，漏掉的是例外，方向是对的。
 *
 * 【为什么监听 `pointerdown` 而不是 `click`】
 * `click` 要等到**鼠标松开**才触发。点按钮时人期望的声音是**按下去那一下**，
 * 差了这一下，整个界面会觉得"慢半拍"。`pointerdown` 是按下即响。
 * （代价：按住不放不会重复响，这正是想要的——重复响会很吵。）
 */

import type { Router } from 'vue-router'
import {
  SFX_FILES,
  playSfx,
  primeAudio,
  resolveSources,
  setSfxSources,
  soundBaseOf,
  type SfxName
} from './sfx'

/**
 * 音频登记表：把 `assets/sounds/` 下现有的音频全部登记进来。
 *
 * **目录为空时这里是空对象 —— 那不是错误路径，是当前正常状态。**
 * 主人还没放素材时全部静默（连解码都不会触发），放进去一个就响一个。
 *
 * ⚠️ 和 `MiMascot.vue` / `cursor.ts` 里那两句 glob 一样：**glob 是"打包时"算的**。
 * "丢进去就生效"只在开发模式成立，打包后要重新打包。
 * 开发模式下新文件会让 Vite 重新求值 glob。
 *
 * 认四种扩展名，优先级见 `SOUND_EXT_PRIORITY`。文件名主干见 `SFX_FILES`。
 */
const SOUNDS = import.meta.glob('../assets/sounds/*.{mp3,ogg,wav,m4a}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

/**
 * 把 `assets/sounds/` 里的文件按场合登记进播放引擎，并**立刻开始预解码**。
 * 在应用启动时调一次（`main.ts`）。
 *
 * 【为什么叫 load 而不是 install】
 * 它没有对应的卸载动作 —— 素材装进去就一直在那儿了，不像监听器需要拆。
 * 名字上区分开，免得有人去找一个并不存在的 `unloadSfxAssets()`。
 */
export function loadSfxAssets(): void {
  const paths = Object.keys(SOUNDS)
  /*
   * 顺手搭一张「地址 → 文件名主干」的表递给播放引擎。
   *
   * 【为什么是这一层来搭，而不是让 `sfx.ts` 自己从地址里认】
   * 打包后 Vite 会给文件名加内容哈希（`cat-click-2` → `cat-click-2-a1b2c3.wav`），
   * 从地址反推主干在**开发模式下是对的、打包后是错的** —— 而它错了不报错，
   * 只是"单个文件的增益悄悄失效"。主干在这里是准的：glob 的**键**就是源文件路径。
   */
  const baseOfUrl = new Map<string, string>()
  for (const path of paths) {
    const url = SOUNDS[path]
    if (url) baseOfUrl.set(url, soundBaseOf(path))
  }
  setSfxSources(resolveSources(paths, (p) => SOUNDS[p] ?? ''), baseOfUrl)
}

/**
 * 天生「可点」的元素。**不含 `.class` 选择器** ——
 * 靠类名去猜"这个 div 是不是按钮"是靠不住的（项目里 `.module-item`、
 * `.stage-chip`、`.lesson-item`、`.result-item`… 各有各的名字），
 * 猜错了就是静音或误响。语义标签是浏览器给的确定答案，自己画的走 `data-sfx`。
 */
const NATURALLY_CLICKABLE = 'button, a[href], summary, select, [role="button"]'

/**
 * 「一次交互一声」的窗口（V1-41）：按下出过声的交互，**换页不再补 nav**。
 *
 * 【为什么要有这条规矩】委托层（按按钮出声）和路由层（换页出声）是两条
 * 独立规则，鼠标点一个会跳转的按钮，两声几乎同时响 —— 同一动作两种音色
 * 叠放。定成「这次换页若是刚才那一下按出来的，就由按下那声代表整个交互」。
 *
 * 【为什么是 800ms】点击到 `router.afterEach` 之间正常只有几毫秒，
 * 800ms 足够覆盖先干一点异步小事再跳的按钮；又短于任何"两次有意交互"的
 * 正常间隔。超出窗口的换页照常响 nav。
 */
const PRESS_NAV_DEDUPE_MS = 800

/**
 * 装上全局音效接线。返回卸载函数（给单测用，理由同 `cursor.ts`）。
 *
 * @param router 用来在换页时响一声。传进来而不是在本模块里 import 全局 router，
 *               是为了让"这个模块依赖什么"在签名上一眼可见。
 */
export function installSfxWire(router: Router): () => void {
  /**
   * 上一次「按下出了声」的时刻 —— 「一次交互一声」规矩（V1-41）的账本。
   * 起点 -Infinity：还没按过任何东西时，换页永远不会被它挡住。
   */
  let lastPressSoundAt = Number.NEGATIVE_INFINITY

  /** 出声，并记下"这一下按出了声"（换页要不要让位，比的正是这个时刻） */
  const notePressSound = (name: SfxName): void => {
    playSfx(name)
    lastPressSoundAt = performance.now()
  }

  const onPointerDown = (e: PointerEvent): void => {
    // 无论是哪个键，这一下都算"用户碰了界面" —— 音频上下文该建起来了。
    // 放在最前面，且**不受下面任何 return 影响**：解锁时机越多越好。
    primeAudio()

    // 只给主键配声音。右键会弹上下文菜单、中键是自动滚动，
    // 给它们配音效是错的（那两下不是"点击"）。
    if (e.button !== 0) return

    const target = e.target
    if (!(target instanceof Element)) return

    /*
     * 从按下的位置**由内往外**找这次交互的发声人。
     *
     * `data-sfx="none"` = 「**这个元素自己**不走委托」—— 它把声音交给了
     * 别处（例如收藏星：收/撤的 quack/click 由 store 播，见 FavoriteStar.vue）。
     * none **不否决外层**：写 none 的元素常被包在一个更大的可点元素里，
     * 外层那声要照常出。
     * （V1-41 修：旧实现见到 none 直接 return —— 外层永远发不出声，
     * 和注释里写明的使用场景刚好相反。当时 none 全工程 0 处使用，
     * 所以这处语义修整没有改变任何现有界面的声音。）
     */
    let scope: Element = target
    for (;;) {
      const marked = scope.closest('[data-sfx]')
      if (!marked) {
        // 没有 data-sfx 了：天生可点的元素补一声通用点击音
        if (scope.closest(NATURALLY_CLICKABLE)) notePressSound('click')
        return
      }
      const name = marked.getAttribute('data-sfx')
      if (name === 'none') {
        if (!marked.parentElement) return
        scope = marked.parentElement
        continue
      }
      if (name && name in SFX_FILES) notePressSound(name as SfxName)
      return
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true)

  /*
   * 换页响一声（切换课程、切模块、前进后退都走这里）。
   *
   * 【为什么要吃掉第一次】`afterEach` 在**开屏那一次导航**上也会触发
   * （'/' 重定向到 '/learn'）。那一次用户什么都没点，此时响一声会很突兀，
   * 而且此刻音频上下文还没被解锁，`resume()` 会静默失败——**更糟**：
   * 它看起来"能用"（没报错），下次换页却仍然可能没声，因为失败是静默的。
   * 所以第一次直接跳过，让"用户第一次碰界面"去负责解锁（见上面的 primeAudio）。
   */
  let isFirstNavigation = true
  const offRoute = router.afterEach(() => {
    if (isFirstNavigation) {
      isFirstNavigation = false
      return
    }
    /*
     * 「一次交互一声」（V1-41）：这次换页如果就是刚才**按下那一声**带出来的，
     * 换页不再补 nav —— 否则鼠标点一个会跳转的按钮，按下声和换页声几乎同时响，
     * 同一动作两种音色叠放。
     *
     * 键盘换页（Enter/Space 走的是 click 事件，没有 pointerdown）与程序性换页
     * 都没有按下声，照常响 nav —— 这条规矩不影响它们的换页反馈。
     * 超过窗口的换页（举例：弹确认框、等异步结果之后才跳）也不挡：
     * 那时候"按下那声"已经过去，不再是同一次交互。
     */
    if (performance.now() - lastPressSoundAt < PRESS_NAV_DEDUPE_MS) return
    playSfx('nav')
  })

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    offRoute()
  }
}
