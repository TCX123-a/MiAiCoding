/**
 * V1-55：随机组卷「池子空」的静态锚点闸门（src/renderer/src/views/PracticeView.vue）。
 *
 * 【这个文件在守什么】
 * 整改前的坏法：池子空时按钮**不禁用**，点一下只弹一句「还没练习题」，
 * 不告诉用户「为什么」也**不告诉下一步去哪**。V1-55 修成三件套：
 *   ① 按钮 `:disabled="pool.length === 0"` —— 按不动本身就是提示；
 *   ② 按钮下方 hint 换成 `PRACTICE.POOL_EMPTY`（说清为什么空、怎么让它不空）；
 *   ③ 带路按钮 `.random-go-learn` —— 直达第一门还没学的课（学 ReviewView 空态）。
 * 外加一条兜底：`startRandom()` 里的空池分支**保留**（键盘/将来新入口不许静默）。
 *
 * 【为什么用静态锚点而不是真窗口探针 —— 诚实备注】
 * 「空态今日不可达」：首课恒为 open ⇒ 池子恒非空（内容包里第一课有普通题），
 * 真机上造不出这个状态；要造得动内容包/进度盘，风险大于收益。
 * 所以这里是**防御性分支**，用静态锚点守「接线没被改坏」——
 * 照 wall-glass.test.ts 的 maskComments 模式（本仓库注释里大量示例代码，
 * 不剥注释每一条闸门都会被自己的说明文字绊倒）。
 *
 * 【它抓不到什么】真窗口里的禁用态渲染、点击后的真实跳转 —— 那些要等
 * 某个入口真能到达空池时用探针补。这里只保证模板/脚本里的三件套还在。
 *
 * 【种坏自检（2026-10-16 晨，批②）】把 `:disabled="pool.length === 0"` 改成
 * `:disabled="false"` 跑本文件 → 红（消息直指那一行）；文本还原 → 绿。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from '../../../../shared/__tests__/mask-comments'
import { PRACTICE } from '../copy'

const VIEW = join(__dirname, '..', '..', 'views', 'PracticeView.vue')
const masked = maskComments(readFileSync(VIEW, 'utf8'))

/** 命中位置 → 行号，红的时候直接指到那一行 */
function lineOf(idx: number): number {
  return masked.slice(0, idx).split('\n').length
}

describe('V1-55 随机组卷空池三件套（静态锚点）', () => {
  it('★ ①空池 ⇒ 开始按钮禁用（按不动本身就是提示）', () => {
    const m = /:disabled="pool\.length === 0"\s+@click="startRandom"/.exec(masked)
    expect(m, '没找到「:disabled="pool.length === 0" @click="startRandom"」——按钮的禁用条件被改掉/删掉了？').not.toBeNull()
    expect(lineOf(m!.index)).toBeGreaterThan(0)
  })

  it('★ ②空池 ⇒ hint 换成 POOL_EMPTY（说清为什么空、怎么让它不空）', () => {
    expect(masked).toMatch(/pool\.length === 0 \? PRACTICE\.POOL_EMPTY : PRACTICE\.poolSize\(pool\.length\)/)
    // 文案本身不许是空串（空串等于没有提示）
    expect(PRACTICE.POOL_EMPTY.trim().length).toBeGreaterThan(0)
  })

  it('★ ③空池 ⇒ 带路按钮直达第一门可学的课（v-if + goLearn + GO_LEARN 文案）', () => {
    const el = /<MiButton(?=[^>]*class="random-go-learn")[^>]*>[\s\S]*?<\/MiButton>/.exec(masked)
    expect(el, '没找到 .random-go-learn 带路按钮').not.toBeNull()
    expect(el![0]).toContain('v-if="pool.length === 0 && firstLearnable"')
    expect(el![0]).toContain('@click="goLearn"')
    expect(el![0]).toContain('PRACTICE.GO_LEARN')
    expect(PRACTICE.GO_LEARN.trim().length).toBeGreaterThan(0)

    // goLearn 的接线：有目标才跳，跳的是 /lesson/<第一门 open 课>
    expect(masked).toMatch(/if \(firstLearnable\.value\) router\.push\(`\/lesson\/\$\{firstLearnable\.value\.id\}`\)/)
    // firstLearnable 的判据：status === 'open' 的第一门课（不是随手第一门）
    expect(masked).toMatch(/const firstLearnable = computed\(\(\) => \{[\s\S]*?statusOf\(x\.id\) === 'open'[\s\S]*?\}\)/)
  })

  it('兜底：startRandom 里的空池分支保留（键盘/将来新入口不许静默发卷）', () => {
    expect(masked).toMatch(
      /function startRandom\(\)\s*\{[\s\S]{0,200}?pool\.value\.length === 0[\s\S]{0,200}?toast\(TOAST\.NO_QUESTIONS_YET, 'warn'\)\s*\n\s*return/
    )
  })
})
