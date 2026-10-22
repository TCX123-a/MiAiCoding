/**
 * 本地写协议（docs/21 §8.2 三件套之一二）的**线形** —— 读口带出的盒戳、
 * 写口带回的结局，两端（主进程 / 渲染层）与 preload 共用这一份。
 *
 * 【为什么这一条协议存在】整份写（渲染层把 profile / favorites / memo
 * 全量发回来）有一个静默坏法：写者手里的快照旧了，而它一无所知 —— 落盘
 * 就把「它没见过的新数据」整份覆盖掉。profile/favorites 更狠一层：主进程
 * 按 diff 维护 learnedAt / 墓碑，一份旧快照会让"云端刚并进来的学习记录"
 * 被读成"用户删掉了它"，删除证据一落，数据就真没了。
 *
 * 【两族写口的边界（别把第二族也做成条件写）】
 *   · 条件写族（本文件服务的）：**整份写** —— profile / favorites / memo。
 *     读口带出 `{data, stamp}`；写口入参带 stamp、校验不符即拒（结果见
 *     DocWriteResult）、并回读最新数据；渲染层收到冲突 = 重载 + 重放 + 再写
 *     （执行器在 renderer/src/lib/doc-writer.ts）。
 *   · 操作型族（**不用戳**）：wrongbook 三条 / practice / rewards / checkin /
 *     challenge。它们的写口在主进程里对**最新盘面**做读-改-写（同步执行，
 *     无 await 缝），副本天然合得上 —— 给它们也加戳只会让"盘面合法地变了"
 *     误报成冲突，把用户操作延迟到重放路径上（违背「用户操作永不丢」的初衷）。
 *
 * 【失败即值】冲突不是异常：跨 IPC 抛错误只带得走 message，code 会整个丢掉
 * （ipc-channels.ts 的注释），而渲染层的下一步动作完全由 code 决定 ——
 * 所以冲突一律走 DocWriteResult 的失败分支回来。真正抛的只有「载荷形状不对」
 * （我们自己的接线 bug）与磁盘 IO 失败。
 *
 * 【stamp 缺席 = 无条件下写】照旧允许（老路径与"读口都没读到就写"的极端态）。
 * 渲染层正常路径**一律带戳** —— 不带戳的写是协议外的逃生口，不是常态。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */

/**
 * 条件写的最小缝：`epoch`（盒屏障号，switchTo 一律 +1）+ `rev`（盒内写代次，
 * 每 BoxedStore 实例进程内单调）。语义真源与校验实现在 main/store/box.ts ——
 * 这里放的是**线形**（它能过 IPC、渲染层能保管它）。
 */
export interface BoxStamp {
  epoch: number
  rev: number
}

/** 冲突码：epoch 对不上 = 盒换了（切换发生在往返途中）；rev 对不上 = 同盒但快照旧了 */
export type DocWriteConflictCode = 'STALE_EPOCH' | 'STALE_REV'

/**
 * 读口形状：数据 + 它现在的戳。渲染层拿住戳，下一次整份写原样带回。
 * `data` 可为 null（档案文件不存在/首启），戳仍然有效 —— 首写就该带它。
 */
export interface StampedDoc<T> {
  data: T
  stamp: BoxStamp
}

/**
 * 整份写口的结局。
 *   · ok：写下去了；`stamp` 是**这一次写之后**的新戳（渲染层收好，供下次写）。
 *   · 冲突：一个字节都没写；`current` 是**回读的最新数据**（渲染层拿它重载、
 *     在它之上重放未保存的变更、再带新戳重写）；`stamp` 是当前戳。
 */
export type DocWriteResult<T> =
  | { ok: true; stamp: BoxStamp }
  | { ok: false; code: DocWriteConflictCode; current: T; stamp: BoxStamp }
