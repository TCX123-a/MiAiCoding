/**
 * 按键串行队列（P10.3）：同一份文档的「读→改→写」严格按提交顺序执行。
 *
 * 【为什么需要】文档的写者不止一个：渲染层保存（IPC）、主进程的差量写、
 * 同步引擎的合并回写。只要链路上出现 await（网络往返、防抖、异步 I/O），
 * 两个写者就可能交错 —— 后一个基于**过期快照**的写会覆盖前一个，而且这种
 * 丢数据没有任何地方会报错。队列 = 每个 key 一条 promise 链：同 key 的任务
 * 一个跑完才跑下一个；不同 key 互不阻塞。
 *
 * 【同步任务也进队列】任务本身是同步的（读→改→写一气呵成）时，它在链上
 * 独占一个 microtask 槽，天然不会被同 key 的异步任务插进中间 —— 这是
 * 「进同一队列」对老写路径零成本的落地方式。
 *
 * 【失败不断链】任务抛了，失败回给提交者拿到的 promise，但链本身继续 ——
 * 下一个任务照常跑。若让失败把链变成 rejected，一次磁盘抖动就会让该文档
 * 后续所有写静默挂死，比丢一次写更坏。
 *
 * 【任务里别再排同 key 的队】任务内再 `run(key, …)` 同一个 key 会等自己，
 * 死锁。要接着排就等本次 `run` 的 promise 结算之后再排。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */

export interface KeyedQueue<K extends string> {
  /** 把任务排到 `key` 的链尾；返回的 promise 带任务结果/异常，链不受影响 */
  run<T>(key: K, task: () => T | Promise<T>): Promise<T>
}

export function createKeyedQueue<K extends string>(): KeyedQueue<K> {
  // 每个 key 只存「当前链尾」；尾任务结算后若没有新任务就把表项清掉，
  // Map 不随任务次数增长（key 集合本身有限，但没理由让它常驻）
  const tails = new Map<K, Promise<void>>()

  return {
    run<T>(key: K, task: () => T | Promise<T>): Promise<T> {
      const tail = tails.get(key) ?? Promise.resolve()
      const next = tail.then(() => task())
      // 链尾吞掉失败（失败已经由 next 回给提交者）—— 见文件头「失败不断链」
      const guard = next.then(
        () => undefined,
        () => undefined
      )
      tails.set(key, guard)
      void guard.then(() => {
        // 结算时若期间又排了新任务，tails 里已是新尾巴，不能误删
        if (tails.get(key) === guard) tails.delete(key)
      })
      return next
    }
  }
}
