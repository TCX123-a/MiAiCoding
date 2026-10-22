/**
 * 文档哈希（P10.3）：同步账本里「这份内容是不是账本那一刻那份」的凭据。
 *
 * sha256(canonicalJson(v)) —— canonicalJson 保证跨进程逐字节稳定
 * （键序不参与），所以两台设备、两次运行对同一份数据算出同一个 hex。
 * 账本（.sync/state.json 的 docs[].hash）与这里用的是同一个函数：
 * 换算法 = 换凭据，旧账本的 hash 会全部对不上（表现为一轮全量重推），
 * 要改必须同时想清楚这段过渡。
 *
 * node:crypto 不在 `src/main/cloud/**` 零网络闸门的禁用表里（它不是网络原语）；
 * 校验这一点的正样本自检在 __tests__/no-network.test.ts。
 *
 * ⚠️ 字符串一律 english，中文只出现在注释里。
 */
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../shared/cloud/canonical-json'

export function hashDocPayload(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}
