/**
 * device.json —— 设备级身份（P10.1 第 2 项）。
 *
 * 【installId 为什么必须是 canonical UUID】
 *   1. 它同时是 practice 会话 uid 的命名空间（docs/22 §7.1-6：uid = `installId:id`）——
 *      两台设备各自的会话 id 都从头数起，只有前缀能把它们分开；
 *   2. 将来上送服务端时落进 `challenge_days.install_id uuid` 列
 *      （server/migrations/0003_challenge.sql:25），也是 `RICE_ENTRY_KEY_RE`
 *      入口键的前缀 —— 形状不对的串到了服务端会被整条拒掉。
 *   所以这里从第一天就按 canonical UUID 生成与校验；磁盘上形状不对的值一律换新
 *   （宁可换，也不留一个将来必然被服务端拒掉的 id 在档里）。
 *
 * 【为什么有效就一个字节都不写】
 *   本函数挂在启动路径上，每次启动都会调一次。若「读出来再原样写回」，每次冷启
 *   都会翻一次 mtime、生成一份 .bak —— 备份轮换、按 mtime 判新旧（P10.3 同步
 *   引擎）都会因此误判，而且没有任何地方会报错。所以「幂等」是硬语义：
 *   文件有效 ⇒ 返回磁盘上那份，文件一个字节不动（连 mtime 都不许动）。
 *
 * 【clientLabel 是干什么的】
 *   设备在登录界面上的显示名（register/login 的 `clientLabel` 字段，
 *   服务端 zod 1~64，server/src/routes/auth.ts:29）。来源 = 主机名，
 *   空白主机名退成 'device'，再截到 64。它只是给人的标签，不参与任何判等。
 *
 * 【文件存在但坏 ⇒ 出声】唯有「文件不存在」才是静默的首跑；读到的东西对不上
 *   （形状不对、连 JSON 都读不出来）必须 console.warn —— 静默重建是铁律禁止的。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { existsSync } from 'fs'
import { hostname as osHostname } from 'os'
import { join } from 'path'
import { createJsonStore } from './json-store'
import { isCanonicalUuid } from './account-id'

export const DEVICE_FILE_VERSION = 1

/** 文件名：给 json-store 与 existsSync 判「文件在不在」共用，只在这里写一次 */
const FILE_NAME = 'device.json'

/** 拿不到主机名时的兜底标签 */
const DEFAULT_CLIENT_LABEL = 'device'

/** 服务端 clientLabel 上限（auth.ts:29 的 zod 1~64） */
const CLIENT_LABEL_MAX = 64

export interface DeviceInfo {
  version: number
  /** canonical UUID；practice 会话 uid 的前缀、服务端 install_id 列的取值 */
  installId: string
  /** 登录设备显示名（1~64 字符） */
  clientLabel: string
  /**
   * 大白饭 entryKey 的设备级序号分配器（P10.x 上行接线）：已分配出去的最大 seq。
   * **可选**：旧档没有这个字段是正常升级态（语义 = 0），读到原样返回、一个字节不写
   * （本函数的幂等硬语义见文件头）；只有分配器真的发号时才写回（saveDeviceFile）。
   * 为什么它在 device.json 而不在账本里：账本可能整份丢失/重建，而**序号绝不能
   * 回卷** —— `${installId}:${seq}` 是服务端的幂等键，回卷 = 新条目撞上旧键被
   * 当成重放静默丢弃（用户的饭凭空消失且无从对账）。device.json 是这台机器上
   * 比账本更长寿的锚。
   */
  riceSeq?: number
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 非空字符串（去空白后仍有内容才算） */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/** 非负整数（riceSeq 的口径：序号必须能给 num 比较，字符串 "3" 拿去比永远不会相等） */
function isRiceSeq(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/**
 * 磁盘上那份是不是已经可用。判据三条：
 *   · installId 过 canonical UUID 白名单（理由见文件头）；
 *   · clientLabel 是非空字符串（空白标签不可能由本模块写出 ⇒ 是外部改的）；
 *   · version 是有限数。**version 也算一条**：本模块的每次写入都带 version，
 *     缺 version / version 不是数字的文件一定不是我们写的；但它只影响
 *     「要不要修一遍写回」——installId / label 这些能救的字段照样先救（见下）。
 *     是别的**有限数**（将来版本）⇒ 原样放行、不重写：降级安装不许把新版本文件打回去。
 */
function isDeviceInfo(v: unknown): v is DeviceInfo {
  if (!isObject(v)) return false
  if (typeof v.version !== 'number' || !Number.isFinite(v.version)) return false
  if (!isCanonicalUuid(v.installId)) return false
  if (!isNonEmptyString(v.clientLabel)) return false
  // riceSeq 缺字段 = 旧档（合法，语义 0）；在但坏值 = 不是我们写的，走修复路径
  if (v.riceSeq !== undefined && !isRiceSeq(v.riceSeq)) return false
  return true
}

/** 主机名 → 合法 clientLabel：trim → 空退 'device' → 截到 64 */
function labelFromHost(host: string | undefined): string {
  const trimmed = (host ?? '').trim()
  if (trimmed === '') return DEFAULT_CLIENT_LABEL
  return trimmed.slice(0, CLIENT_LABEL_MAX)
}

/**
 * 拿到设备身份；必要时把 device.json 建出来。出口语义：
 *   · 文件有效 ⇒ 原样返回（不落盘，见文件头）；
 *   · 文件不存在 ⇒ 静默建档（首跑，正常路径）；
 *   · 文件在但对不上 ⇒ 能救的字段救下来、出声、写回。
 */
export function ensureDeviceFile(baseDir: string, opts?: { hostname?: () => string }): DeviceInfo {
  const store = createJsonStore<DeviceInfo>(baseDir, FILE_NAME)
  const raw: unknown = store.read()
  const getHost = opts?.hostname ?? osHostname

  if (raw === null) {
    // 读到 null 有两种：文件根本不在（首跑，静默），以及文件在但连 JSON 都读不出来
    // （坏透了，必须出声 —— 静默重建是铁律禁止的）
    if (existsSync(join(baseDir, FILE_NAME))) {
      console.warn('[miai] device.json is unreadable, rebuilt with a fresh installId')
    }
    const fresh: DeviceInfo = {
      version: DEVICE_FILE_VERSION,
      installId: crypto.randomUUID(),
      clientLabel: labelFromHost(getHost())
    }
    store.write(fresh)
    return fresh
  }

  if (isDeviceInfo(raw)) return raw

  // 到这里：文件在、能读到 JSON，但过不了 isDeviceInfo。逐字段能救则救：
  // installId 坏 = 身份没了，只能换新（它要进 practice uid 与服务端 uuid 列）；
  // label 坏 = 显示名而已，重新从主机名取；version 坏 = 写回当前版本。
  const obj: Record<string, unknown> = isObject(raw) ? raw : {}
  const bad: string[] = []

  let installId: string
  const rawInstallId: unknown = obj.installId
  if (isCanonicalUuid(rawInstallId)) {
    installId = rawInstallId
  } else {
    installId = crypto.randomUUID()
    bad.push('installId')
  }

  let clientLabel: string
  const rawLabel: unknown = obj.clientLabel
  if (isNonEmptyString(rawLabel)) {
    clientLabel = rawLabel
  } else {
    clientLabel = labelFromHost(getHost())
    bad.push('clientLabel')
  }

  const rawVersion: unknown = obj.version
  if (typeof rawVersion !== 'number' || !Number.isFinite(rawVersion)) bad.push('version')

  // riceSeq：缺 = 旧档正常升级（不记 bad，也不凭空补 0 —— 不写字段就是语义 0）；
  // 在但坏 = 修的活。**坏值不猜**：修成 0 而不是从账本抄一个，抄错会把发号器
  // 钉死在一个旧值上，之后每条新账都撞幂等键 —— 宁可让分配器的
  // max(device.riceSeq, 账本最大 seq + 1) 从账本安全网里恢复。
  let riceSeq: number | undefined
  const rawRiceSeq: unknown = obj.riceSeq
  if (rawRiceSeq !== undefined) {
    if (isRiceSeq(rawRiceSeq)) riceSeq = rawRiceSeq
    else bad.push('riceSeq')
  }

  const repaired: DeviceInfo = {
    version: DEVICE_FILE_VERSION,
    installId,
    clientLabel,
    ...(riceSeq === undefined ? {} : { riceSeq })
  }
  console.warn(`[miai] device.json: invalid ${bad.join('+')}, repaired in place`)
  store.write(repaired)
  return repaired
}

/**
 * 写回整份 device.json。**只给「有意写」的调用方**（riceSeq 分配器发号后的落盘）——
 * 启动路径一律走 ensureDeviceFile 的幂等语义（文件有效 ⇒ 一个字节不写），
 * 谁把启动路径接到这里谁就在每次冷启时翻 mtime、轮换 .bak（事故，见文件头）。
 */
export function saveDeviceFile(baseDir: string, info: DeviceInfo): void {
  createJsonStore<DeviceInfo>(baseDir, FILE_NAME).write(info)
}
