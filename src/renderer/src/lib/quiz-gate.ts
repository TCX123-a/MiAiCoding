/**
 * 答题会话闸（P10.6）：全项目**唯一**的「现在有没有答题会话在跑」真相。
 *
 * 【为什么要有这么一个两行的模块】docs/21 §8.2：冲突的重载 + 重放不能让
 * 答题会话脚下的状态被换掉 —— 会话进行中一律挂起，会话结束的安全点统一
 * 收账。判据的写入方是 quiz store（`session !== null` ⇔ 会话在跑），
 * 读取方是三个整份写 store 的 doc-writer —— 如果它们直接 import quiz store，
 * 就形成 doc-store → quiz → content 的依赖链（而 quiz 又 import 各 doc 的
 * 记账函数），环随时可能咬人。真相放这个叶子模块里：谁都不 import，
 * 只有两行状态加一个订阅表。
 *
 * 【为什么用"订阅空闲"而不是轮询】挂起的收账时机恰好就是「会话关掉」那一下
 * （结果页点关闭 / 中途退出）——订阅表让那一下直接触发 resolveNow，
 * 不需要任何定时器。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */

let active = false
const idleListeners = new Set<() => void>()

/** quiz store 调：会话开/关。只在**关**的那一下通知订阅者（开的时候没什么可收账的） */
export function setQuizActive(next: boolean): void {
  if (next === active) return
  active = next
  if (!next) {
    for (const cb of [...idleListeners]) cb()
  }
}

export function isQuizActive(): boolean {
  return active
}

/** 订阅「会话结束」；返回退订函数（store 通常不退订，进程内一只活到底） */
export function onQuizIdle(cb: () => void): () => void {
  idleListeners.add(cb)
  return () => {
    idleListeners.delete(cb)
  }
}
