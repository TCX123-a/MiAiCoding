/**
 * 账号 ID 的白名单校验（P10.1）—— 任何把 accountId 拼进文件路径之前，必须先过这里。
 *
 * 【为什么必须存在】accountId 来自服务端响应（登录 / 会话探测的 `account.id`）。
 * 服务端是我们自己的、今天确实只发 UUID —— 但「上游可信」不是一个能拼路径的
 * 理由：一旦（版本漂移、代理篡改、将来某个调试开关）响应体里出现 `../../`
 * 这类 id，`join(base, 'accounts', id)` 就会把读写引到账号目录之外 ——
 * 那是「A 读写 B 的档案」甚至「覆盖任意文件」级别的事故。
 * 路径穿越的防线只有一条：**拼路径前先验证**，且判据是白名单
 * （canonical UUID 全匹配），不是黑名单（"查有没有 `..`" 永远漏）。
 *
 * 【为什么大小写不敏感、还要归一成小写】UUID 规范里大小写不区分；
 * PostgreSQL 的 canonical 形式是全小写，但别的来源（手抄、将来换实现）可能给大写。
 * 归一之后再拼路径，「同一个账号」在任何来源下都落到同一个目录 ——
 * 不归一就会出现同一账号的大写目录、小写目录两套档案，而两边都不报错。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */

/** canonical UUID：8-4-4-4-12 个十六进制位。不限版本号 —— 版本位是服务端的事，不是路径安全的事 */
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 是不是 canonical UUID（大小写均可）。只回答「形状」，不做任何 IO */
export function isCanonicalUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && CANONICAL_UUID_RE.test(raw)
}

/**
 * 白名单断言：形状不对就**抛**（TypeError，这是"调用方给了坏东西"，不是业务失败）。
 * 通过则返回**小写归一**后的 id —— 调用方拼路径必须用返回值，不许再用原串。
 */
export function assertSafeAccountId(raw: unknown): string {
  if (!isCanonicalUuid(raw)) {
    // 消息里带截断后的原值：排查时要看得到"到底是什么东西被拒了"；
    // 它最多是个 id 形状的串，不是凭据，进日志安全
    const shown = typeof raw === 'string' ? JSON.stringify(raw.slice(0, 80)) : typeof raw
    throw new TypeError(`unsafe account id: ${shown}`)
  }
  return raw.toLowerCase()
}
