/**
 * 猫爪指针的接线逻辑（src/renderer/src/lib/cursor-assets.ts）
 *
 * 【这个文件在守什么】
 * 这个功能最狠的一点是：**它坏了完全没有症状**。
 *
 *   拼错 cursor 值 → 全站 `pointer` 手型集体消失，界面照常能点、能跑，
 *   `getComputedStyle` 平静地返回 `auto`（和"本来就没设过 cursor"一模一样）；
 *   找错图 → 主人明明把文件放进去了却还是系统箭头，而代码一个字都不报。
 *
 * 上一版真的踩过第一条（实测：全页面 117 个 `auto`、0 个 `pointer`），
 * 所以下面两组断言是**硬要求，不是风格偏好**：
 *
 *   1. `cursorValue()` 拼出来的一律**以关键字收尾**（「两条硬规则」之一）
 *   2. `findCursor()` 的扩展名优先级与 `.cur` / `.png` 的分支差异
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it } from 'vitest'
import {
  CURSOR_EXT_PRIORITY,
  CURSOR_FALLBACK,
  CURSOR_FILES,
  cursorBaseOf,
  cursorExtOf,
  cursorValue,
  findCursor,
  PAW_HOTSPOT
} from '../cursor-assets'

// ---------------------------------------------------------------- 路径解析

describe('cursorBaseOf() / cursorExtOf()：从 glob 路径取零件', () => {
  it('取出文件名主干（带目录的完整路径也一样）', () => {
    expect(cursorBaseOf('../assets/cursors/cat-claw.cur')).toBe('cat-claw')
    expect(cursorBaseOf('../assets/cursors/cat-claw-click.png')).toBe('cat-claw-click')
  })

  it('主干里的短横线不能当成扩展名分隔符', () => {
    // 这条是真正会出问题的地方：`cat-claw-click` 里有两个 `-`，
    // 如果用 `-` 去找扩展名，会得到 "click" 这个不存在的格式。
    expect(cursorBaseOf('../assets/cursors/cat-claw-click.cur')).toBe('cat-claw-click')
    expect(cursorExtOf('../assets/cursors/cat-claw-click.cur')).toBe('cur')
  })

  it('扩展名一律小写：主人在资源管理器里看到大写也不会因此失效', () => {
    expect(cursorExtOf('../assets/cursors/cat-claw.CUR')).toBe('cur')
    expect(cursorExtOf('../assets/cursors/cat-claw.PnG')).toBe('png')
  })

  it('没有扩展名时返回空串，而不是整条路径或 undefined', () => {
    // glob 模式只认 .cur/.png，所以这种情况在真实调用里不会出现；
    // 但它决定了 `findCursor` 的匹配行为，要钉住。
    expect(cursorExtOf('../assets/cursors/cat-claw')).toBe('')
  })

  it('目录名里有点号时，取的是文件名那一段（不是目录的）', () => {
    expect(cursorExtOf('../assets/cursors.v2/cat-claw.cur')).toBe('cur')
  })
})

// ---------------------------------------------------------------- 找图

describe('findCursor()：在目录现有的文件里找一张', () => {
  const UP = '../assets/cursors/cat-claw.cur'
  const UP_PNG = '../assets/cursors/cat-claw.png'
  const DOWN = '../assets/cursors/cat-claw-click.cur'

  it('目录是空的（**当前的真实状态**）→ null，不抛错', () => {
    expect(findCursor([], CURSOR_FILES.up)).toBeNull()
    expect(findCursor([], CURSOR_FILES.down)).toBeNull()
  })

  it('找到就返回那条路径本身', () => {
    expect(findCursor([UP], CURSOR_FILES.up)).toBe(UP)
  })

  it('.cur 优先于 .png（两个都在时）', () => {
    // 同时放两份，多半是主人想试 png 效果却忘了删旧的。
    // 跟着 `.cur` 走是安全的：它自带热点，不需要我们猜。
    expect(findCursor([UP_PNG, UP], CURSOR_FILES.up)).toBe(UP)
    expect(findCursor([UP, UP_PNG], CURSOR_FILES.up)).toBe(UP)
  })

  it('只有 .png 也能用（退而求其次，靠 PAW_HOTSPOT）', () => {
    expect(findCursor([UP_PNG], CURSOR_FILES.up)).toBe(UP_PNG)
  })

  it('只放了按下的那一张时，松开的返回 null —— 这正是"只放一半"的中间状态', () => {
    expect(findCursor([DOWN], CURSOR_FILES.up)).toBeNull()
    expect(findCursor([DOWN], CURSOR_FILES.down)).toBe(DOWN)
  })

  it('主干必须是完全相等，不能前缀命中', () => {
    // 少了这一条，`cat-claw-click.cur` 会被当成 `cat-claw` 的素材 ——
    // 症状是"松开时的指针变成了按下的样子"，看起来像按下状态卡住了。
    expect(findCursor([DOWN], CURSOR_FILES.up)).toBeNull()
  })

  it('不认识的扩展名一律不认（比如主人顺手存的 .svg / .ico）', () => {
    expect(findCursor(['../assets/cursors/cat-claw.svg'], CURSOR_FILES.up)).toBeNull()
    expect(findCursor(['../assets/cursors/cat-claw.ico'], CURSOR_FILES.up)).toBeNull()
  })

  it('优先级表的顺序就是 .cur 在前 —— 改顺序要连带改这条测试', () => {
    expect(CURSOR_EXT_PRIORITY[0]).toBe('cur')
    expect(CURSOR_EXT_PRIORITY).toContain('png')
  })

  it('目录里堆着一堆无关文件也不会找不到', () => {
    const messy = [
      '../assets/cursors/README.md',
      '../assets/cursors/old-paw.bak.cur',
      UP,
      '../assets/cursors/cat-claw-click.png'
    ]
    expect(findCursor(messy, CURSOR_FILES.up)).toBe(UP)
    expect(findCursor(messy, CURSOR_FILES.down)).toBe(
      '../assets/cursors/cat-claw-click.png'
    )
  })
})

// ---------------------------------------------------------------- 拼值（最要命的一组）

describe('cursorValue()：拼出一条合法的 CSS cursor 值', () => {
  const URL = '/assets/cat-claw-a1b2c3.cur'

  it('⚠️ 永远以一个通用关键字收尾 —— 少了它整条声明作废', () => {
    // 这是本项目踩过的最深的一个坑。CSS 规范要求带 url() 的 cursor 值列表
    // 必须以通用关键字结尾；少了它浏览器把整条 cursor 当没写过，
    // 而**全站 31 处都写成 `cursor: var(--mi-cursor, …)`**，
    // 于是变量展开出来的坏值会把所有 pointer 手型一起干掉。
    //
    // 这条断言不能写成 `toContain(', pointer')` 就完事 —— 得确认它在**末尾**。
    expect(cursorValue(URL, 'cur')).toMatch(/\bpointer$/)
    expect(cursorValue(URL, 'png')).toMatch(/\bpointer$/)
  })

  it('.cur 不带热点坐标（热点在文件里，外面再写只会让两处分歧）', () => {
    expect(cursorValue('/x/cat-claw.cur', 'cur')).toBe('url("/x/cat-claw.cur"), pointer')
  })

  it('.png 必须带上 PAW_HOTSPOT', () => {
    expect(cursorValue('/x/cat-claw.png', 'png')).toBe(
      `url("/x/cat-claw.png") ${PAW_HOTSPOT}, pointer`
    )
  })

  it('地址一律加引号 —— 路径里出现空格或括号时，不加引号会拼出坏值', () => {
    expect(cursorValue('/x/my paw.cur', 'cur')).toContain('url("/x/my paw.cur")')
  })

  it('逗号一定在 url() 之后、关键字之前（这是列表分隔符，不是随手加的）', () => {
    const v = cursorValue(URL, 'cur')
    expect(v.indexOf(')')).toBeLessThan(v.indexOf(', pointer'))
  })

  it('热点坐标就是外面的那一个常量，别在函数里写死一份新的', () => {
    expect(cursorValue(URL, 'png')).toContain(PAW_HOTSPOT)
  })
})

// ---------------------------------------------------------------- 兜底值

describe('CURSOR_FALLBACK：一张图都没有时用什么', () => {
  it('是纯关键字 pointer，不是 url()、不是空串', () => {
    // 选 pointer 而不是 auto 是刻意的：auto 会让按钮失去手型，
    // "东西看起来点不动"比"正文多了手型"严重得多。
    expect(CURSOR_FALLBACK).toBe('pointer')
  })

  it('不含 url() —— 兜底值必须是**无条件合法**的', () => {
    expect(CURSOR_FALLBACK).not.toContain('url(')
    expect(CURSOR_FALLBACK).not.toContain('(')
  })
})

// ---------------------------------------------------------------- 文件名约定

describe('CURSOR_FILES：两条文件名约定', () => {
  it('按下和松开是两个不同的主干（写成同一个会让按下时看起来毫无变化）', () => {
    expect(CURSOR_FILES.up).not.toBe(CURSOR_FILES.down)
  })

  it('就是主人被告知的那两个名字', () => {
    // README 里写给主人看的就是这两个。改名要同时改 README，否则
    // 他按旧名字放文件 → 什么都不会发生 → 只会以为"代码没写好"。
    expect(CURSOR_FILES.up).toBe('cat-claw')
    expect(CURSOR_FILES.down).toBe('cat-claw-click')
  })
})
