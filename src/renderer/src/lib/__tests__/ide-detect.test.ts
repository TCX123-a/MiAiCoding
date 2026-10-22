/**
 * 「🔍 自动检测」的结局翻译（lib/ide-detect.ts）。
 *
 * 【这个文件在守什么】四档结局（one / many / none / failed）的下一步各不相同，
 * 而这个模块是**唯一的翻译处** —— 它把主进程的返回值压成「接下来干什么」。
 * 译错的方式全是静默的：空表被当成失败（用户去重试一个根本不会变的检测）、
 * 失败被当成空表（用户去重装一个明明装着的 IDE）、一个候选也弹选择框
 * （无谓地挡一层）。中文文案的分工见 copy.ts 里那两条注释。
 */
import { describe, expect, it } from 'vitest'
import { detectIdeOnce, planIdeChoice } from '../ide-detect'
import type { IdeCandidate, IdeDetectResult } from '../../../../shared/types'

/** 装上假的 window.miai（只有这一个方法 —— 这个模块也只用这一个） */
function stubMiai(detectIde: () => Promise<IdeDetectResult>): void {
  ;(globalThis as unknown as { window: unknown }).window = { miai: { detectIde } }
}

const DEVC: IdeCandidate = { path: 'C:\\PF86\\Dev-Cpp\\devcpp.exe', name: 'Dev-C++', source: 'known' }
const CODE: IdeCandidate = { path: 'C:\\X\\Code.exe', name: 'Visual Studio Code', source: 'shortcut' }
/** 同一产品装在另一处（平手局的另一半） */
const DEVC2: IdeCandidate = { path: 'D:\\Tools\\devcpp.exe', name: 'Dev-C++', source: 'known' }
const IDEA: IdeCandidate = { path: 'C:\\JetBrains\\idea64.exe', name: 'IntelliJ IDEA', source: 'known' }
const NPAD: IdeCandidate = { path: 'C:\\Npp\\notepad++.exe', name: 'Notepad++', source: 'registry' }

describe('detectIdeOnce：四档结局', () => {
  it('空表 → none（**不是失败**：下一步是手动选）', async () => {
    stubMiai(() => Promise.resolve({ ok: true, candidates: [] }))
    expect(await detectIdeOnce()).toEqual({ kind: 'none' })
  })

  it('恰一个 → one，候选原样带出来（调用方要拿 path 去存配置）', async () => {
    stubMiai(() => Promise.resolve({ ok: true, candidates: [DEVC] }))
    expect(await detectIdeOnce()).toEqual({ kind: 'one', candidate: DEVC })
  })

  it('多个 → many（让用户自己挑，**不替他从里面选第一个**）', async () => {
    stubMiai(() => Promise.resolve({ ok: true, candidates: [DEVC, CODE] }))
    expect(await detectIdeOnce()).toEqual({ kind: 'many', candidates: [DEVC, CODE] })
  })

  it('ok:false → failed（**不许并进 none**：没查成 ≠ 你没装）', async () => {
    stubMiai(() => Promise.resolve({ ok: false, reason: 'failed', detail: 'boom' }))
    expect(await detectIdeOnce()).toEqual({ kind: 'failed' })
  })

  it('IPC 自己炸（reject）→ 也算 failed，一个异常都不冒出去', async () => {
    stubMiai(() => Promise.reject(new Error('no handler registered')))
    expect(await detectIdeOnce()).toEqual({ kind: 'failed' })
  })
})

// ---------------------------------------------------------------- planIdeChoice（v9 按语言推荐）

/**
 * 【这组守什么】「检测结果 + 语言 → 接下来干什么」是 v9 的产品口径拍板处
 * （主人 2026-10-01：**直接选最优**）：
 *   · 合适者里榜首唯一 → choose（落盘 + 打开一条龙，不再多弹一层框）；
 *   · 平手（同一产品装了两份）/ 矮子里挑将军（不止一台都不合适）→ pick 弹框；
 *   · 候选只有一台 → 无论合适与否都 choose（没得挑，弹框是多余的）。
 * 判定收在纯函数里就是为了这组测试 —— 仓库没有组件测试设施，
 * 留在组件里等于没测试，而"顺手简化成永远弹框/永远选第一个"都会静默改变体验。
 */
describe('planIdeChoice：按语言定「直接选谁 / 弹框 / 报什么」', () => {
  it('none / failed 原样透传（两档的下一步不同，不许在这里合并）', () => {
    expect(planIdeChoice('c', { kind: 'none' })).toEqual({ kind: 'none' })
    expect(planIdeChoice('c', { kind: 'failed' })).toEqual({ kind: 'failed' })
  })

  it('★ 主人验收的那一对：C 在 Dev-C++ 与 VS Code 之间**必选 Dev-C++**', () => {
    // 反过来的话，「打开」会把 C 代码塞给 VS Code（默认 UTF-8），
    // 而我们按 Dev-C++（GBK）写了盘 —— 乱码又以新的组合回来了。
    const plan = planIdeChoice('c', { kind: 'many', candidates: [CODE, DEVC] })
    expect(plan).toEqual({ kind: 'choose', candidate: DEVC })
  })

  it('候选只有一台时：合适 → choose；**不合适也 choose**（没得挑，弹框是多余的）', () => {
    expect(planIdeChoice('c', { kind: 'one', candidate: DEVC })).toEqual({
      kind: 'choose',
      candidate: DEVC
    })
    expect(planIdeChoice('java', { kind: 'one', candidate: NPAD })).toEqual({
      kind: 'choose',
      candidate: NPAD
    })
  })

  it('★ 平手（同一产品装了两份）→ pick 弹框，第一台挂「推荐」', () => {
    // 两台 Dev-C++ 的推荐度一模一样，选错路径就是选错程序 —— 必须用户自己点头。
    // 推荐徽标给探测原序里的第一台（稳定排序保原序，见 orderCandidates）。
    const plan = planIdeChoice('c', { kind: 'many', candidates: [DEVC2, DEVC, CODE] })
    expect(plan).toEqual({
      kind: 'pick',
      candidates: [DEVC2, DEVC, CODE],
      hint: 'tie',
      recommendedPath: DEVC2.path
    })
  })

  it('零合适且候选不止一台 → pick + none-suitable，**没有**推荐（recommendedPath 为 null）', () => {
    // 全是白名单外的程序：没有任何排序依据，不许硬造一个"推荐"。
    const other: IdeCandidate = { path: 'D:\\x\\editor.exe', name: 'Some Editor', source: 'registry' }
    const plan = planIdeChoice('java', { kind: 'many', candidates: [NPAD, other] })
    expect(plan).toEqual({
      kind: 'pick',
      candidates: [NPAD, other],
      hint: 'none-suitable',
      recommendedPath: null
    })
  })

  it('混合候选的平手局：弹框里合适者（按推荐序）在前、其余保原序在后', () => {
    // 平手局的弹框要列**全部**候选：用户可能偏偏想用那个"不推荐"的编辑器。
    const idea2: IdeCandidate = { path: 'D:\\JetBrains\\idea64.exe', name: 'IntelliJ IDEA', source: 'registry' }
    const plan = planIdeChoice('java', { kind: 'many', candidates: [NPAD, DEVC, IDEA, idea2] })
    expect(plan).toEqual({
      kind: 'pick',
      candidates: [IDEA, idea2, NPAD, DEVC],
      hint: 'tie',
      recommendedPath: IDEA.path
    })
  })

  it('合适的只有一台 + 若干不合适的 → choose 那一台（不用弹框）', () => {
    const plan = planIdeChoice('java', { kind: 'many', candidates: [NPAD, IDEA, DEVC] })
    expect(plan).toEqual({ kind: 'choose', candidate: IDEA })
  })
})
