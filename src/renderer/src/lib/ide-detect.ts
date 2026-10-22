/**
 * 「🔍 自动检测」的分支收拢：把探测结果翻译成「接下来干什么」。
 *
 * 【为什么两处要共用这一层】设置页和练习场都要走这套判断，而其中
 * 「只找到一个就直接用、多个才弹选择框」是**产品口径** —— 两处各写一遍，
 * 迟早漂移成「这边弹框、那边静默拿了第一个」。收在一处，口径只有一份。
 *
 * 【四档各自的下一步】
 *   one    → 直接填进配置（用户的下一步是点「打开」，不该再挡一层选择框）
 *   many   → 摆出选择框（可能真装了好几样：机房的 Dev-C++ + 自己的 VS Code）
 *   none   → 如实说「没找到」，引导去手动选（**不是错误**）
 *   failed → 如实说「没查成」，可以再点一次（**不许并进 none**：
 *            把「没查成」说成「你没装」，用户会去重装一个明明装着的 IDE）
 */
import type { IdeCandidate, LangOfCode } from '../../../shared/types'
import { orderCandidates, rankOf } from '../../../shared/ide-profiles'

export type IdeDetectOutcome =
  | { kind: 'none' }
  | { kind: 'one'; candidate: IdeCandidate }
  | { kind: 'many'; candidates: IdeCandidate[] }
  | { kind: 'failed' }

/**
 * 检测一次。
 *
 * 【catch 为什么也算 failed 而不是抛出去】主进程那条通道的契约是
 * 「失败即值，不抛」（见 preload 注释），能进 catch 的只有 IPC 自己出事 ——
 * 对用户来说它就是「没查成」的同一种结局，不该让两个调用点各写各的兜底。
 */
export async function detectIdeOnce(): Promise<IdeDetectOutcome> {
  try {
    const r = await window.miai.detectIde()
    if (!r.ok) return { kind: 'failed' }
    if (r.candidates.length === 0) return { kind: 'none' }
    if (r.candidates.length === 1) return { kind: 'one', candidate: r.candidates[0] }
    return { kind: 'many', candidates: r.candidates }
  } catch {
    return { kind: 'failed' }
  }
}

/** 选择框要摆出哪种语境（决定提示行说什么，见 copy.ts 的两个提示函数） */
export type IdePickHint = 'tie' | 'none-suitable'

/**
 * 「检测结果 + 当前语言」→「接下来干什么」的**方案**（v9 按语言推荐的核心判定）。
 *
 * 【为什么收进纯函数】仓库没有组件测试设施（vitest 只收 shared / lib / stores /
 * main），判定要是留在组件里就等于没测试 —— 而「哪个算最优」「什么时候该弹框」
 * 恰是这次最容易被一次"顺手简化"弄坏的口径。收在这里，单测能逐档钉住。
 *
 * 【拍板口径（主人 2026-10-01）：直接选最优】
 *   · 合适者里榜首**唯一** → `choose`：直接用它（调用方落盘 + 打开 + toast 点名），
 *     不再让用户点第二次 —— 一个按钮点下去就该把活干完。
 *   · 榜首**平手**（同一产品装了两份：同 rank = 推荐度一样，分不出高下）→ `pick`：
 *     这是真的二选一，摆选择框，第一台挂「推荐」徽标。
 *   · **一个合适的都没有**：只有一台 → `choose`（没得挑，弹框是多余的）；
 *     多台 → `pick`（矮子里挑将军得让用户自己定）+ none-suitable 提示。
 *   · 选择框列全部候选：合适的按推荐序在前，其余保探测原序在后（见 orderCandidates）。
 *
 * 【none / failed 为什么原样透传】两档的下一步完全不同（一个去手动选、
 * 一个可以再试一次），合并判定就会把「没查成」说成「你没装」—— 同 detectIdeOnce。
 */
export type IdeChoicePlan =
  | { kind: 'choose'; candidate: IdeCandidate }
  | {
      kind: 'pick'
      candidates: IdeCandidate[]
      hint: IdePickHint
      /** 该挂「推荐」徽标的那台的路径；none-suitable 档没有推荐 → null */
      recommendedPath: string | null
    }
  | { kind: 'none' }
  | { kind: 'failed' }

export function planIdeChoice(lang: LangOfCode, outcome: IdeDetectOutcome): IdeChoicePlan {
  if (outcome.kind === 'none') return { kind: 'none' }
  if (outcome.kind === 'failed') return { kind: 'failed' }
  const candidates = outcome.kind === 'one' ? [outcome.candidate] : outcome.candidates
  const { suitable, others } = orderCandidates(lang, candidates)
  const ordered = [...suitable, ...others]
  if (suitable.length === 0) {
    if (ordered.length === 1) return { kind: 'choose', candidate: ordered[0] }
    return { kind: 'pick', candidates: ordered, hint: 'none-suitable', recommendedPath: null }
  }
  // suitable 已按 rank 升序（稳定排序）：与榜首同 rank 的就是「平手」组
  const best = rankOf(lang, suitable[0].name)
  const tied = suitable.filter((c) => rankOf(lang, c.name) === best)
  if (tied.length === 1) return { kind: 'choose', candidate: tied[0] }
  return { kind: 'pick', candidates: ordered, hint: 'tie', recommendedPath: tied[0].path }
}
