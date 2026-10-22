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

describe('V2-41 散点假按钮（右栏推荐课 / 锁定页前置课）', () => {
  it('ref-item 与 required-item 都是 <button>', () => {
    assertClassOnButtons('components/domain/RightPanel.vue', 'ref-item')
    assertClassOnButtons('views/LessonDetailView.vue', 'required-item')
  })
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
