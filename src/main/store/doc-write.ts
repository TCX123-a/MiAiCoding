/**
 * 条件写的**主进程执行器**（P10.6，docs/21 §8.2 三件套之一）——
 * 把「写一次 + 撞 Stale 屏障」翻译成线形的 DocWriteResult（失败即值）。
 *
 * 【为什么抽成一个小文件而不是内联在 app.ts 的每个 handler 里】
 * 三份整份写文档（profile / favorites / memo）的 handler 都需要**逐字相同**的
 * 一段：试写 → 成功带上新戳 / 撞屏障回读最新数据带上现戳 / 别的错误原样抛。
 * 内联三份的那天，就是三份开始漂移的那天 —— 而这里漂移的后果（比如把
 * 磁盘 IO 错误也吞成冲突）是"重载重放一遍再把同一个 IO 错误撞一遍"，
 * 用户看到保存永远不成功、日志里一句真话都没有。所以判定收在一处、有单测。
 *
 * 【catch 的边界必须收窄】只认 StaleEpochError / StaleRevError 两种具名错误
 * （box.ts 刻意做成具名类，就是为了这里能 instanceOf 地分开）。其余一律
 * rethrow —— 磁盘写不进去是「写不进去」，不是「这次写不该发生」，
 * 两者混成一个类别的坏处写在 box.ts 的 StaleEpochError 注释里。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import type { DocWriteResult } from '../../shared/doc-write'
import { StaleEpochError, StaleRevError, type BoxStamp } from './box'

export interface DocWriteAttempt<D> {
  /** 真正落盘的那一步（内部自己带 stamp 校验；撞屏障时**一个字节都没写**） */
  write: () => void
  /** 回读最新数据（与对应读口**同一形状**：渲染层要拿它当"重载结果"直接用） */
  readCurrent: () => D
  /** 现读当前戳（成功路径上要在 write 之后读：rev 是写后自增的） */
  stamp: () => BoxStamp
}

export function attemptDocWrite<D>(opts: DocWriteAttempt<D>): DocWriteResult<D> {
  try {
    opts.write()
  } catch (err) {
    if (err instanceof StaleRevError) {
      return { ok: false, code: 'STALE_REV', current: opts.readCurrent(), stamp: opts.stamp() }
    }
    if (err instanceof StaleEpochError) {
      return { ok: false, code: 'STALE_EPOCH', current: opts.readCurrent(), stamp: opts.stamp() }
    }
    throw err
  }
  return { ok: true, stamp: opts.stamp() }
}
