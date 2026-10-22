/**
 * 日期分桶口径 —— 「某件事属于哪一天」全项目唯一的答案。
 *
 * 【口径：固定北京时间（UTC+8）】
 * 2026-10-22 主人拍板：全部统一为中国时间，不再跟随运行机器的本地时区。
 * 中国自 1991 年起没有夏令时，固定 +08:00 是正确且最稳定的做法；不依赖
 * 系统时区、`TZ` 环境变量或 `Intl` 的时区数据库。
 *
 * 【为什么不直接用 `new Date().toISOString().slice(0, 10)`】
 * 因为 `toISOString()` 给的是 **UTC**。北京用户在凌晨 0 点到早上 8 点之间，
 * UTC 那边**还是昨天**：
 *
 *     北京 2026-09-13 07:30 (UTC+8)
 *       → toISOString()      = '2026-09-12T23:30:00.000Z'
 *       → .slice(0, 10)      = '2026-09-12'        ← 差了一天
 *
 * 后果不是「日期显示得不好看」，是**数据落在错误的那一格**：
 * 学习热力图会把今天学的那一课画到昨天（用户会觉得「我明明学了怎么没记上」），
 * 错题本会把今天错的题标成昨天。而且它**只在特定时间段出现**，
 * 白天测怎么都是对的 —— 典型的「上线三个月后才有人报」的 bug。
 *
 * 【那么 ISO 时间戳还存不存？】
 * 存，而且照旧存 UTC。因为时间戳记录的是**时刻**（「这件事发生在哪一瞬间」），
 * 时刻是时区无关的，存 UTC 是正确的；只有在**要把它归到哪一天**的时候，
 * 才需要做时区转换 —— 那正是这个文件存在的意义。
 *
 * 一句话：**存时刻用 `new Date().toISOString()`，分桶用这里。**
 */

/** 北京时间的固定偏移（毫秒）。中国无夏令时，不需要按日期变化。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 一个绝对时刻在北京时间下的日历/墙钟字段。 */
export interface BeijingParts {
  y: number
  m: number
  d: number
  h: number
  min: number
  s: number
}

/**
 * 把绝对时刻拆成北京时间的年/月/日/时/分/秒。
 *
 * 【实现】先给 epoch 加 8 小时，再读 UTC 字段 —— 等价于「把时钟拨到北京」。
 * 不要改用本机 getFullYear/getHours：那会重新退回机器时区，正是本次要根除的。
 */
export function beijingParts(d: Date): BeijingParts {
  const t = new Date(d.getTime() + BEIJING_OFFSET_MS)
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    min: t.getUTCMinutes(),
    s: t.getUTCSeconds()
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/**
 * Date → `'YYYY-MM-DD'`（**北京时间**）。
 *
 * 名字保留 `localDateKey` 是为了不把全仓几十处 import 改一遍；它现在的语义
 * 是「北京日」，不是「运行机器的本地日」。新代码请按北京日理解。
 *
 * 补零不是为了好看：日期键要能**按字符串排序就等于按时间排序**，
 * 后面裁「最近 30 天」的窗口靠的就是这个性质。
 * `'2026-9-3'` 一出现，字符串比较立刻失效（`'2026-9-3' > '2026-09-13'`）。
 */
export function localDateKey(d: Date): string {
  const p = beijingParts(d)
  return keyOf(p.y, p.m, p.d)
}

/** 今天（北京时间）的日期键。 */
export function todayKey(now: Date = new Date()): string {
  return localDateKey(now)
}

/**
 * 距下一个**北京时间零点**还有多少毫秒（多给 1 秒缓冲，让翻转发生在零点之后，
 * 而不是卡在边界那一毫秒上）。返回值恒 ≥1000。
 *
 * 给「活时钟」用的（渲染层 lib/day-clock.ts）：常驻应用开着过零点要自己换天，
 * 不能等用户重启。算法是纯 UTC 日历算术（北京时间零点 = 对应 UTC 日期的
 * 前一天 16:00Z），不依赖本机时区，也不受夏令时影响。
 */
export function msUntilNextMidnight(now: Date = new Date()): number {
  const p = beijingParts(now)
  const nextUtc = new Date(0)
  nextUtc.setUTCFullYear(p.y, p.m - 1, p.d + 1)
  nextUtc.setUTCHours(0, 0, 0, 0)
  const nextBeijingMidnightMs = nextUtc.getTime() - BEIJING_OFFSET_MS
  return Math.max(1000, nextBeijingMidnightMs - now.getTime() + 1000)
}

/**
 * ISO 时间戳字符串 → 北京日期键。**传进来不是合法时间就返回 `null`**。
 *
 * 返回 null 而不是抛错、也不是原样吞下：调用方一个是热力图（该条记录跳过即可），
 * 一个是错题本（显示个占位符即可），两处都**不该因为一条脏数据整页崩掉**。
 * 但也不能悄悄返回 `''` —— 那个空串会变成一个不存在的日期格子，
 * 比明确知道「这条坏了」更难查。
 */
export function localDateKeyOf(iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return localDateKey(new Date(t))
}

/**
 * 日期键往前/往后挪若干天（`days` 为负即往前）。非法输入返回 `null`。
 *
 * 【纯日历算术】用 UTC 构造器 + UTC getter，和运行时区完全无关。
 * 不能继续用 `new Date(y, m - 1, d + days)`：那是本机时区的构造器，
 * 在 UTC+9~+14 的机器上本地零点已经是北京的前一天，会让签到连续天数、
 * 30 天裁剪、签到月历整体偏一天。
 */
export function shiftDateKey(key: string, days: number): string | null {
  const parsed = parseDateKey(key)
  if (!parsed) return null
  const date = new Date(0)
  date.setUTCFullYear(parsed.y, parsed.m - 1, parsed.d + days)
  date.setUTCHours(0, 0, 0, 0)
  return keyOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** 日期键是否落在「从 today 往前数 n 天」的窗口内（含两端，含今天） */
export function isWithinDays(key: string, n: number, today: string = todayKey()): boolean {
  const cutoff = shiftDateKey(today, -(n - 1))
  if (!cutoff) return false
  return key >= cutoff && key <= today
}

/** 解析 `'YYYY-MM-DD'`；形状不对或不是真实存在的日期都返回 null */
export function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  // 挡掉 '2026-02-31' 这种「格式对但日子不存在」的：用纯 UTC 日历构造，
  // 溢出会被规范化成 3 月 3 日，回读一下对不上就说明原键是假的。
  // 用 setUTCFullYear 而不是 Date.UTC：后者把 0~99 年映射成 1900+y。
  const probe = new Date(0)
  probe.setUTCFullYear(y, mo - 1, d)
  probe.setUTCHours(0, 0, 0, 0)
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null
  }
  return { y, m: mo, d }
}
