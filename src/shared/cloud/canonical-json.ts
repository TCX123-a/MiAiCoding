/**
 * 规范 JSON（P10.3）：跨进程逐字节稳定的序列化 —— 「同不同」判据的唯一尺子。
 *
 * 【为什么不能裸 JSON.stringify】`JSON.stringify` 的输出依赖对象**键的插入
 * 顺序**。同一份数据经过不同路径（PG jsonb 往返会重排键、合并函数以不同
 * 顺序重建对象、磁盘上的旧文件）序列化结果就不同。拿它当「本地和云端一样
 * 吗」的判据，同步会**永远收敛不了**：每轮都以为对方变了，每轮都推一遍。
 * 本函数把同一份数据折叠成唯一字符串：键排序后序列化，数组保序。
 *
 * 【规则（与 JSON 语义对齐）】
 *   · 普通对象（含 null 原型）：键按 code unit 升序（JS 默认 sort），丢弃
 *     undefined 值的属性（JSON.stringify 同款），其余递归；
 *   · 数组：保序递归；undefined 元素成 null（JSON.stringify 同款）；
 *   · 带 toJSON 的对象（Date 等）与一切非普通对象（类实例）：**交给原生
 *     JSON.stringify**（不解析它们的内部结构，键序此时不保证 —— 文档数据
 *     模型里不会出现这类值，出现即上层构造错了）；
 *   · 标量：原生 JSON.stringify（NaN/Infinity → null，BigInt 照旧抛）。
 *
 * 【谁在用】① 合并函数的平局裁决（同 key 平局时 canonical JSON 大者胜 ——
 * 两端各自算必然同结果，才有「两台设备独立裁决结果一致」）；② 同步引擎的
 * 文档哈希 hashDocPayload（账本 hash 与推送前判等）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */

/** 普通对象 = Object 字面量或 Object.create(null)（这两类才敢按自有可枚举键递归） */
function isPlainObject(v: object): boolean {
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'

  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) parts.push(canonicalJson(item))
    return '[' + parts.join(',') + ']'
  }

  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      // Date / 类实例 / 带 toJSON 的东西：原生语义（含 toJSON 调用）。
      // toJSON 返回 undefined 时原生结果也是 undefined —— 按 JSON 语义成 null
      return JSON.stringify(value) ?? 'null'
    }
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      const v = obj[k]
      if (v === undefined) continue // JSON.stringify 对 undefined 属性就是丢弃
      parts.push(JSON.stringify(k) + ':' + canonicalJson(v))
    }
    return '{' + parts.join(',') + '}'
  }

  // 标量。JSON.stringify(undefined) 返回 undefined（不是字符串）：
  // 顶层 undefined 与数组元素 undefined 的 JSON 语义都是 null
  const s = JSON.stringify(value)
  return s === undefined ? 'null' : s
}
