/**
 * V1-44：答题选项点击音的静态锚点闸门（QuizChoice.vue）。
 *
 * 【这个文件在守什么】
 * 选项是 `role="radio"` 的自绘 div —— 不在 sfx-wire 的 NATURALLY_CLICKABLE
 * （button/a/summary/select/[role=button]）里，也没挂 data-sfx 时点击是**沉默**的：
 * 全应用最高频的动作（选答案）只有边框变色、没有声音确认（V1-44，主人裁定「要改」）。
 * 修法 = 选项显式挂 `data-sfx="click"`，声音交给 lib/sfx-wire.ts 的全局委托播
 * （「委托默认有声、例外显式表态」的设计口径；对照：侧栏行 data-sfx="nav"、
 * 立绘 data-sfx="quack"）。本文件守三件事：
 *   ① 属性还在、值就是 'click'（改名字面量 ⇒ 红）；
 *   ② 'click' 确实是 SFX_FILES 里的真场合（表里改名 ⇒ 属性变哑弹，这里红）；
 *   ③ 选项没变成 NATURALLY_CLICKABLE 里的标签（button/role=button）——
 *      若将来换了标签，data-sfx 仍优先生效，但键盘语义（role=radio 那套
 *      radiogroup 约定，批①V2-32 的成果）不许被动掉，一并钉住。
 *
 * 【为什么是静态锚点 + 委托层已有单测】真窗口探针听不见声音（无输出设备的
 * 无头环境里 AudioContext 也不报错），声音链路的活窗证据归批⑦探针（若做）。
 * 这里只保证「表态没被改坏」——接线断掉时红在源头，而不是等耳朵发现。
 *
 * 【它抓不到什么】真点击是否真的出声（音量/节流/音频语境）—— 那是 sfx.ts
 * 自身单测（sfx.test.ts）与委托层的覆盖范围。
 *
 * 【种坏自检（2026-10-16 晨，批④）】把模板里 `data-sfx="click"` 改成
 * `data-sfx="click2"` 跑本文件 → 红（消息直指那一行）；文本还原 → 绿。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from '../../../../shared/__tests__/mask-comments'
import { SFX_FILES } from '../sfx'

const COMP = join(__dirname, '..', '..', 'components', 'domain', 'quiz', 'QuizChoice.vue')
const masked = maskComments(readFileSync(COMP, 'utf8'))

/** 命中位置 → 行号，红的时候直接指到那一行 */
function lineOf(idx: number): number {
  return masked.slice(0, idx).split('\n').length
}

describe('V1-44 选项点击音（静态锚点）', () => {
  it('★ 选项挂着 data-sfx="click"（且仍在 role="radio" 的选项 div 上）', () => {
    const m = /role="radio"[\s\S]{0,400}?data-sfx="click"[\s\S]{0,200}?@click="pick\(i\)"/.exec(masked)
    expect(
      m,
      'QuizChoice.vue 的选项 div 上找不到 data-sfx="click"（或被改值/挪位）——点击音表态被改坏？'
    ).not.toBeNull()
    expect(lineOf(m!.index)).toBeGreaterThan(0)
  })

  it("★ 'click' 是 SFX_FILES 里的真场合（表里改了名 ⇒ 属性成哑弹）", () => {
    expect('click' in SFX_FILES).toBe(true)
    expect(SFX_FILES.click.length).toBeGreaterThan(0)
  })

  it('键盘语义没被动掉：role="radio" 与 :tabindex 仍在选项上（批①V2-32 的成果）', () => {
    expect(masked).toMatch(/role="radio"[\s\S]{0,200}?:tabindex="submitted \? -1 : 0"/)
    expect(masked).toMatch(/role="radiogroup"/)
  })
})
