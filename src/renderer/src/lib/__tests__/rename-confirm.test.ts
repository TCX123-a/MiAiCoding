/**
 * 改名二次确认的静态锚点闸门（src/renderer/src/views/LoginView.vue，2026-10-22）。
 *
 * 【为什么有这道闸】用户名同时是登录身份：改完旧名字就登不上。主人拍板
 * 必须加一道「修改后您需要用新名字登录哦」的醒目确认。这条链路的顺序是
 * 安全本身的一部分：
 *
 *     saveName 本地校验（空/未改/格式/敏感词）全过
 *       → 锁 pendingName + 弹确认（**不发任何网络请求**）
 *       → confirmNameChange 里才 acct.updateUsername(pendingName)
 *
 * 顺序错一步就会出事：校验前弹框（坏名字也弹）、弹框前发请求（确认成了摆设）、
 * 确认时重读输入框（理论上存在「审 A 发 B」的窗口）。
 *
 * 【为什么是静态闸而不是组件测试】views/ 不在 vitest include 里，仓库也没有
 * @vue/test-utils / happy-dom（同 account.test.ts:559 的说明）。真实弹窗行为
 * 由真窗口 CDP 探针验收；这里只钉接线与顺序，防止后续重构把它们改没。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from '../../../../shared/__tests__/mask-comments'
import { ACCOUNT } from '../copy'

const VIEW = join(__dirname, '..', '..', 'views', 'LoginView.vue')
const masked = maskComments(readFileSync(VIEW, 'utf8'))

/** 取一个函数的函数体（函数右花括号在行首，嵌套块的右花括号都带缩进） */
function bodyOf(fn: string): string {
  const marker = `async function ${fn}(`
  const start = masked.indexOf(marker)
  expect(start, `LoginView.vue 里找不到 ${marker}`).toBeGreaterThan(-1)
  const open = masked.indexOf('{', start)
  const close = masked.indexOf('\n}\n', open)
  expect(close, `${fn} 的函数体没有正常收尾`).toBeGreaterThan(open)
  return masked.slice(open, close)
}

describe('改名二次确认（静态锚点）', () => {
  it('★ 顺序：本地校验 → 弹确认 → 才发请求', () => {
    const checkIdx = masked.indexOf('findSensitiveUsernameWord(name) !== null')
    const openIdx = masked.indexOf('nameConfirmVisible.value = true')
    const sendIdx = masked.indexOf('acct.updateUsername(')
    expect(checkIdx, '找不到敏感词本地预检').toBeGreaterThan(-1)
    expect(openIdx, '找不到打开确认框的语句').toBeGreaterThan(-1)
    expect(sendIdx, '找不到真正的改名 IPC 调用').toBeGreaterThan(-1)
    expect(checkIdx).toBeLessThan(openIdx)
    expect(openIdx).toBeLessThan(sendIdx)
  })

  it('★ 发请求只有一处，且只在 confirmNameChange 里；saveName 不许偷偷发', () => {
    expect(masked.split('acct.updateUsername(').length - 1).toBe(1)
    expect(bodyOf('confirmNameChange')).toContain('acct.updateUsername(')
    expect(bodyOf('saveName')).not.toContain('acct.updateUsername(')
    // 确认时发的是校验时锁下的 pendingName，不是重读输入框
    expect(bodyOf('confirmNameChange')).toContain('const name = pendingName.value')
  })

  it('★ 模板：确认框绑对状态/文案/两个按钮，上传在飞时不可被 Esc/遮罩关掉', () => {
    const block = [...masked.matchAll(/<MiModal[\s\S]*?<\/MiModal>/g)]
      .map((m) => m[0])
      .find((b) => b.includes('nameConfirmVisible'))
    expect(block, '模板里找不到绑定 nameConfirmVisible 的 MiModal').toBeTruthy()
    expect(block).toContain(':title="ACCOUNT.NAME_CONFIRM_TITLE"')
    expect(block).toContain('ACCOUNT.NAME_CONFIRM_BODY')
    expect(block).toContain('ACCOUNT.NAME_CONFIRM_CANCEL')
    expect(block).toContain('ACCOUNT.BTN_NAME_CONFIRM')
    expect(block).toContain('@click="confirmNameChange"')
    expect(block).toContain('@click="cancelNameConfirm"')
    expect(block).toContain(':closable="acct.busy !== \'profile\'"')
  })

  it('★ 文案必须说清「以后用新名字登录」，且不能是空串', () => {
    expect(ACCOUNT.NAME_CONFIRM_TITLE.trim().length).toBeGreaterThan(0)
    expect(ACCOUNT.NAME_CONFIRM_BODY).toContain('登录')
    expect(ACCOUNT.NAME_CONFIRM_BODY).toContain('新名字')
    expect(ACCOUNT.BTN_NAME_CONFIRM.trim().length).toBeGreaterThan(0)
    expect(ACCOUNT.NAME_CONFIRM_CANCEL.trim().length).toBeGreaterThan(0)
    // 不能拿成功 toast 冒充确认正文
    expect(ACCOUNT.NAME_CONFIRM_BODY).not.toBe(ACCOUNT.OK_NAME)
  })
})
