/**
 * 解锁纯函数（M3-03 正式验收，单测目标之一）。
 * 规则：无前置的课天然可学；有前置的课需「全部前置都已学完（learned）」才解锁；
 * 已学的课永远可进入（用于复习）。
 * 注意：解锁看「已学」而非「已解锁」——否则一条链会一口气全开（M3-03 单测曾抓到该 bug）。
 */

export interface Unlockable {
  id: string
  required: string[]
}

export function computeUnlocked(all: Unlockable[], learned: ReadonlySet<string>): Set<string> {
  const unlocked = new Set<string>(learned)
  for (const l of all) {
    if (unlocked.has(l.id)) continue
    if (l.required.length === 0 || l.required.every((r) => learned.has(r))) {
      unlocked.add(l.id)
    }
  }
  return unlocked
}

export function statusOf(
  id: string,
  lesson: Unlockable | undefined,
  learned: ReadonlySet<string>,
  unlocked: ReadonlySet<string>
): 'locked' | 'open' | 'learned' | 'missing' {
  if (!lesson) return 'missing'
  if (learned.has(id)) return 'learned'
  return unlocked.has(id) ? 'open' : 'locked'
}
