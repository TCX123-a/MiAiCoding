/**
 * 账号页的两处视图逻辑（V1-62 起）。
 *
 * 【为什么搬出来】logout 的两个出口（Sidebar 身份菜单、LoginView 账号块）
 * 都要说同一句话，而 views/ 不在 vitest 的 include 里 —— 判定留在 .vue 里
 * 就没有任何单测守得住（同 wrongbook-view.ts 的理由）。这里只放"给定失败码
 * 该说什么"这类纯映射，动作本身仍留在各自的视图里。
 */
import { ACCOUNT } from './copy'
import type { CloudFailureCode } from '../../../shared/cloud/dto'

/**
 * 登出失败时该说的话（V1-62）。
 *
 * NETWORK / TIMEOUT 走专门文案：断网时"退出登录需要联网"才是完整的答复
 * —— 通用的 ERR.NETWORK（「连不上服务器，检查一下网络」）没说清用户最关心
 * 的那件事：**什么都没变**（令牌还在、人还在登录态、本地数据一个字节没动），
 * 不是"登出到一半坏了"。TIMEOUT（等满 10 秒没回）本质也是网络没通，同一句。
 * 其余失败码照旧查 ERR 表（如实报码是第一纪律，不为好看改口径）。
 */
export function logoutFailureText(code: CloudFailureCode): string {
  if (code === 'NETWORK' || code === 'TIMEOUT') return ACCOUNT.ERR_LOGOUT_NETWORK
  return ACCOUNT.ERR[code]
}
