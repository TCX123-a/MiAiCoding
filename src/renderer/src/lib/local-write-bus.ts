/**
 * 本地写总线（P10.6）：全项目**唯一**的「刚刚有本地文档写下去了」通知点。
 *
 * 【为什么要有这么一个十行的模块】同步节拍器（stores/cloud-sync.ts）要在
 * 「本地写完」之后防抖触发一轮云同步，而本地写的成功点散布在各处
 * （三个整份写 store 的 doc-writer、错题本三条动作、练习史记录、签到/发图
 * 这两条主进程 RMW）。如果节拍器挨个去 import 那些 store 订阅 ——
 * 依赖方向就反了（它们又会 import 各种业务件，环随时可能咬人）。
 * 真相放这个叶子模块里：谁都不 import（只认 shared 的 DocType 类型），
 * 只有一张订阅表加一个广播。
 *
 * 【为什么带 doc 参数】两端都不白干活：通知方说得出写的是哪份文档
 * （它们本来就在写 `DocType` 里的东西）；接收方（同步节拍器）目前**只关心
 * "响了"** —— 该推哪些文档由同步轮自己从盘上重算（主进程账本才是权威，
 * 在渲染层攒"写过什么"是第二份真源），doc 参数留给诊断/测试与将来的按需补轮。
 * ⚠️ `memo` 不在 `DocType` 里 —— 备忘录**不进云端**（docs/22 §4.2 的四份
 * 文档没有它），所以 memo store 不接这个总线，不是漏了。
 *
 * 【谁发、谁收】
 *   · 发：progress / favorites 两个 doc-writer 的 onSaved、签到与发图这两条
 *     主进程 RMW 的成功回话、quiz 的错题本三条动作与 practice 记录成功回调。
 *   · 收：cloud-sync store 的节拍器（防抖 30s → 一轮 syncNow）。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */
import type { DocType } from '../../../shared/cloud/protocol'

const listeners = new Set<(doc: DocType) => void>()

/** 广播一次「这份文档刚在本地写成功了」。无订阅者时是空转（no-op） */
export function notifyLocalWrite(doc: DocType): void {
  for (const cb of [...listeners]) cb(doc)
}

/** 订阅本地写事件；返回退订函数（store 通常不退订，进程内一只活到底） */
export function onLocalWrite(cb: (doc: DocType) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
