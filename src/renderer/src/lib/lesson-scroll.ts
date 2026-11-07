/**
 * 课文阅读位置的本地记忆（2026-11-01）。
 *
 * 【为什么不进 profile / 云端档案】
 * 它描述的是「这台电脑上，这一篇课文上次滚到哪」，不是学习成果：
 * 换一台电脑读到哪不重要，同步上去反而会让云档案多出一堆只对本机有意义的
 * 数字，还要处理多端互相覆盖。localStorage 的粒度正好 —— 清了缓存就从头读，
 * 不影响任何进度。
 *
 * 读写全部走这里、不直接碰 localStorage：组件里散着 try/catch 迟早会有
 * 一处忘了包（隐私模式下访问 localStorage 会抛），而抛在滚动监听里
 * 会变成一个没人看得见的控制台错误。存储坏了就当作「没有记忆」。
 */

/** 每个课号一个键：`miai_lesson_scroll_<lessonId>`（主人 2026-11-01 指定） */
export const LESSON_SCROLL_PREFIX = 'miai_lesson_scroll_'

/**
 * 只依赖这三样，测试才能塞一个假存储进来。
 * 不直接用 `Storage` 类型：Node 下没有 DOM 类型，而这个文件要能被单测直接跑。
 */
export interface ScrollStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function lessonScrollKey(lessonId: string): string {
  return `${LESSON_SCROLL_PREFIX}${lessonId}`
}

/**
 * 读到保存的位置；没有 / 坏了 / 存储不可用都返回 0（从头读）。
 *
 * 不把「读不到」和「存的是 0」分开：两者对恢复动作是同一件事 —— 滚到顶。
 * 负数和 NaN 一律归 0，绝不把它们交给 scrollTo（有些 Chromium 版本会把
 * 负值当成 0，另一些会直接忽略整次调用，后者会静默地不恢复）。
 */
export function readLessonScroll(
  storage: ScrollStorage | null | undefined,
  lessonId: string
): number {
  if (!storage || lessonId === '') return 0
  try {
    const raw = storage.getItem(lessonScrollKey(lessonId))
    if (raw === null) return 0
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.floor(value)
  } catch {
    return 0
  }
}

/**
 * 写入一次位置。
 *
 * `<= 0` 时删键而不是存 "0"：滚到顶 = 没有需要恢复的记忆，
 * 删掉能让 localStorage 只保留真正「读到一半」的课。
 * 非法值（NaN / Infinity）返回 false 且**不动旧值** —— 一次坏读数
 * 不该把用户原来读到一半的位置抹掉。
 */
export function writeLessonScroll(
  storage: ScrollStorage | null | undefined,
  lessonId: string,
  scrollTop: number
): boolean {
  if (!storage || lessonId === '') return false
  if (!Number.isFinite(scrollTop)) return false
  try {
    if (scrollTop <= 0) {
      storage.removeItem(lessonScrollKey(lessonId))
      return true
    }
    storage.setItem(lessonScrollKey(lessonId), String(Math.floor(scrollTop)))
    return true
  } catch {
    return false
  }
}

/**
 * 把保存值夹进当前可滚范围。
 *
 * 课文会改版、字号会缩放：上次存 1800px，这次整篇只有 1200px 可滚 ——
 * 直接 scrollTo(1800) 浏览器会自己夹到 1200，但恢复循环里用它和
 * `scrollHeight` 比较时会永远「还没到」，白等满重试次数。先夹再比。
 */
export function clampScrollTop(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (!Number.isFinite(max) || max <= 0) return 0
  return Math.min(Math.floor(value), Math.floor(max))
}
