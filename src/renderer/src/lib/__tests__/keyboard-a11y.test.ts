import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from '../../../../shared/__tests__/mask-comments'

/**
 * 键盘可达批（V2-34/36/37/38/40/41，2026-10-16 夜 UX 整改）的静态判据。
 *
 * 【钉的是什么】这一批全是「div/span 假按钮 → 真 <button>」和「弹层焦点纪律」——
 * 它们的失效方式**不报错、不崩、鼠标用户零感知**：谁哪天顺手把某格改回 div、
 * 或把 focus/trapTab 那段删掉，界面上完全看不出来，键盘党却重新掉进死角。
 * 所以每条修复都在这里落一个源码级钉子。
 *
 * 【为什么读源码文本，不挂载组件】与 copy.test.ts / sidebar-groups.test.ts
 * 同一处境：本仓 vitest 跑在 node 环境、没装 vue 插件，.vue 文件进不来。
 * 因此照抄那套「读文件 + maskComments」——本仓注释里写了大量与代码同形的
 * 示例（这批的修复注释尤其多），不剥注释，闸门会被自己的说明文字绊倒。
 */

const SRC_DIR = join(__dirname, '..', '..')
const read = (rel: string): string => maskComments(readFileSync(join(SRC_DIR, rel), 'utf8'))

/**
 * `index` 处的属性属于哪个开标签 —— 从该位置往回找最近的 `<标签名`。
 * 判据成立的前提：class 属性在它自己的开标签内部，字符位置到标签的 `<`
 * 之间不可能出现 `>`（出现了就说明匹配越过了标签边界，那时返回的是
 * 后面那个标签 —— 正则只会返回 `[^>]*$` 能匹配上的那一段，越界即失配，
 * 返回 '?'，断言照样红）。
 */
function tagAt(text: string, index: number): string {
  const m = text.slice(0, index).match(/<([a-zA-Z][a-zA-Z0-9-]*)[^>]*$/)
  return m ? m[1] : '?'
}

/** 某个静态 class 的每一处出现，都必须挂在 <button> 上 */
function assertClassOnButtons(rel: string, cls: string): void {
  const src = read(rel)
  const hits = [...src.matchAll(new RegExp(`class="${cls}`, 'g'))]
  expect(hits.length, `${rel} 里应至少有一处 class="${cls}"`).toBeGreaterThan(0)
  for (const h of hits) {
    expect(
      tagAt(src, h.index ?? 0),
      `${rel} 的 class="${cls}" 必须挂在 <button> 上（假按钮回归！）`
    ).toBe('button')
  }
}

describe('V2-34 侧栏假按钮全量转正', () => {
  it('语言格 / 阶段块 / 课列表行全部是 <button>', () => {
    assertClassOnButtons('components/domain/Sidebar.vue', 'module-item')
    assertClassOnButtons('components/domain/Sidebar.vue', 'stage-chip')
    assertClassOnButtons('components/domain/Sidebar.vue', 'lesson-item')
  })

  it('配套的 button 默认外观重置 + 焦点环在场（拆不干净会一眼露馅）', () => {
    const src = read('components/domain/Sidebar.vue')
    for (const rule of ['button.stage-chip', 'button.lesson-item', 'button.module-item']) {
      expect(src, `缺 ${rule} 的重置规则`).toContain(rule)
    }
    // focus-visible 环：转换后每类按钮都要有（div 时代它们压根不可聚焦）
    expect(src).toMatch(/button\.stage-chip:focus-visible[\s\S]{0,120}outline:/)
    expect(src).toMatch(/button\.lesson-item:focus-visible[\s\S]{0,200}outline:/)
  })
})

describe('V2-41 散点假按钮（右栏推荐课）', () => {
  it('ref-item 是 <button>', () => {
    assertClassOnButtons('components/domain/RightPanel.vue', 'ref-item')
  })
  // 2026-10-31：原「锁定页前置课 required-item」随硬锁拆除一并下线。
  // 新课页的软锁提示是一句纯文案（不是可点的前置课清单），这条钉子
  // 不再有对象 —— 留一条永假断言只会挡住整轮测试，故连用例一起去掉。
})

describe('V2-40 首页今日挑战卡整卡可聚焦', () => {
  it('challenge-card 是 <button>（做完了/没题/锁定时也要有 Tab 停点）', () => {
    assertClassOnButtons('views/LearnView.vue', 'challenge-card')
  })
})

describe('V2-36 MiModal 焦点纪律（对齐 FullscreenMenu 三件套）', () => {
  const src = read('components/base/MiModal.vue')

  it('dialog 语义 + 面板可接焦点', () => {
    expect(src).toContain('role="dialog"')
    expect(src).toContain('aria-modal="true"')
    expect(src).toContain('tabindex="-1"')
    expect(src).toMatch(/:aria-label="title"/)
  })

  it('三件套在场：打开时 focus、Tab 陷阱、关闭时还原焦点', () => {
    expect(src, '缺 focusables() 现查').toContain('function focusables')
    expect(src, '缺 Tab 陷阱').toContain('function trapTab')
    expect(src, '打开时未聚焦面板').toMatch(/nextTick\(\(\) => panel\.value\?\.focus\(\)\)/)
    expect(src, '缺焦点还原').toContain('restoreTo')
  })

  it('✕ 有可读名字（读屏不再只听见一个乘号）', () => {
    expect(src).toContain('MODAL.CLOSE_TITLE')
  })
})

describe('V2-37 答题浮层 Esc + 焦点', () => {
  const src = read('components/domain/quiz/QuizOverlay.vue')

  it('dialog 语义与读屏名在场', () => {
    expect(src).toContain('role="dialog"')
    expect(src).toContain('aria-modal="true"')
    expect(src).toContain('QUIZ.DIALOG_LABEL')
  })

  it('Esc 落点是退出确认（做题中）且套娃弹层礼让在场', () => {
    expect(src, '缺键盘处理函数').toContain('function onQuizKey')
    expect(src, 'Esc 未接退出确认').toMatch(/Escape[\s\S]{0,400}exitConfirmOpen\.value = true/)
    // 礼让判据必须**两处都在**：trapTab 与 onQuizKey 各自独立地让位。
    // 只查「出现过」会漏掉「删了一处」（种坏自检实测过这点：删掉 Esc 那处
    // 而留 Tab 那处，toContain 照样绿）。
    const yieldHits = [
      ...src.matchAll(/document\.querySelector\('\.mi-modal-mask'\)/g)
    ]
    expect(
      yieldHits.length,
      '套娃弹层礼让应有两处（trapTab 与 onQuizKey 各一），少一处就会和 MiModal 抢 Esc/Tab'
    ).toBeGreaterThanOrEqual(2)
    expect(src, '缺 Tab 陷阱').toContain('function trapTab')
    expect(src, '关闭时未还原焦点').toContain('restoreTo')
  })
})

describe('V2-38 撤销 toast 键盘可达', () => {
  const src = read('components/base/MiToast.vue')

  it('容器带 role=status + aria-live，动作按钮出现时被聚焦', () => {
    expect(src).toContain('role="status"')
    expect(src).toContain('aria-live="polite"')
    expect(src, '缺动作按钮登记').toContain('setActionEl')
    expect(src, '带动作 toast 出现时未聚焦撤销').toMatch(/nextTick\(\(\) => actionEls\.get\(id\)\?\.focus\(\)\)/)
  })
})

// ---------------------------------------------------------------- P2 无障碍批量（2026-10-31 自检）

/**
 * 【这一节守什么】2026-10-31 全量自检的无障碍 P2 批量：判分结果没有 live
 * region、壁纸选择与指针落点只能鼠标操作、页签没有 tabs 语义、纯符号图标钮
 * 没有可访问名、Teleport 浮层不跟随应用缩放。
 *
 * 全部是「鼠标用户零感知、读屏/键盘用户直接掉进死角」的坏法 —— 没有报错、
 * 没有崩溃，只能靠源码钉子。zoom 那条还有方向性：**只能挂内容卡，绝不能挂
 * 遮罩外壳**（fixed + inset:0 放进缩放层，定位基准会出问题，见 zoom.css）。
 */
describe('P2 无障碍批量（2026-10-31 自检）', () => {
  it('MiTabs：tablist / tab / aria-selected / 漫游 tabindex', () => {
    const src = read('components/base/MiTabs.vue')
    expect(src).toContain('role="tablist"')
    expect(src).toContain('role="tab"')
    expect(src).toContain(':aria-selected="modelValue === t.key"')
    expect(src, '缺漫游 tabindex（否则整组页签十几个 Tab 停点）').toContain(
      ':tabindex="i === activeIndex ? 0 : -1"'
    )
  })

  it('答题判分：常驻 live region 播报对错与总分', () => {
    const src = read('components/domain/quiz/QuizOverlay.vue')
    expect(src).toContain('class="quiz-live"')
    expect(src).toContain('role="status"')
    expect(src).toContain('aria-live="polite"')
    expect(src, '播报文本必须真的接上判分结果').toContain('const liveMessage = computed')
    expect(src).toMatch(/liveMessage[\s\S]{0,400}QUIZ\.CORRECT/)
    expect(src).toMatch(/liveMessage[\s\S]{0,400}QUIZ\.score\(/)
  })

  it('壁纸选择：行是 listbox option，Enter/空格可选中', () => {
    const src = read('components/domain/WallpaperPickerModal.vue')
    expect(src).toContain('role="listbox"')
    expect(src).toContain('role="option"')
    expect(src).toContain(':aria-selected="it.id === selectedId"')
    expect(src, '行必须能聚焦（tabindex=0）').toContain(':tabindex="0"')
    expect(src, '键盘处理没接上').toContain('@keydown="onRowKey($event, it)"')
    expect(src, '缺 Enter/空格分支').toMatch(/function onRowKey[\s\S]{0,400}e\.key !== 'Enter'[\s\S]{0,80}e\.key !== ' '/)
    // 行里嵌着「预览 / 隐藏」两个真按钮：不判 target 的话，在隐藏钮上按空格
    // 会冒泡成「选中壁纸并关窗」，键盘用户永远隐藏不了任何一张。
    expect(src, '行内按钮的按键会冒泡成选中').toContain('e.target !== e.currentTarget')
  })

  it('指针落点：预览可聚焦，方向键移动、回车/空格确认', () => {
    const src = read('components/domain/CursorSlotPreview.vue')
    expect(src, 'role 仍是 img 就不能是键盘控件').toContain('role="button"')
    expect(src).toContain('tabindex="0"')
    expect(src).toContain('function onKeyPick')
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(src, `缺 ${key} 分支`).toContain(`case '${key}'`)
    }
    expect(src, '回车/空格没有落盘动作').toMatch(/case 'Enter':[\s\S]{0,80}emit\('pick', cur\)/)
  })

  it('纯符号图标钮都有可访问名（读屏不再只念 emoji/加减号）', () => {
    const app = read('App.vue')
    expect(app).toContain(':aria-label="SIDEBAR_TOGGLE[sidebarMode].title"')
    expect(app).toContain(':aria-label="rightPanelOpen ? LAYOUT.COLLAPSE_PANEL : LAYOUT.EXPAND_PANEL"')

    const zoom = read('components/domain/ZoomControl.vue')
    expect(zoom).toContain(':aria-label="ZOOM.OUT"')
    expect(zoom).toContain(':aria-label="ZOOM.IN"')

    const side = read('components/domain/Sidebar.vue')
    expect(side, '侧栏搜索钮缺可访问名').toContain(':aria-label="PLACEHOLDER.SIDEBAR_SEARCH"')
  })

  it('Teleport 浮层：内容卡挂 mi-zoom-layer，遮罩外壳绝不挂', () => {
    const modal = read('components/base/MiModal.vue')
    expect(modal).toContain('class="mi-modal mi-zoom-layer"')
    expect(modal, '遮罩外壳挂缩放会把 fixed 定位基准搞坏').not.toContain(
      'class="mi-modal-mask mi-zoom-layer"'
    )
    // vh/vw 在缩放层里不跟着缩放：上限必须 ÷zoom 折回本地单位
    expect(modal).toMatch(/\.mi-modal\.mi-zoom-layer[\s\S]{0,200}calc\(100vh \/ var\(--mi-zoom\)/)

    const search = read('components/domain/SearchPanel.vue')
    expect(search).toContain('class="search-panel mi-zoom-layer"')
    expect(search, '遮罩外壳不许挂').not.toContain('class="search-mask mi-zoom-layer"')
  })
})
