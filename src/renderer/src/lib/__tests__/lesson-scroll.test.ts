import { describe, expect, it } from 'vitest'
import {
  LESSON_SCROLL_PREFIX,
  clampScrollTop,
  lessonScrollKey,
  readLessonScroll,
  writeLessonScroll,
  type ScrollStorage
} from '../lesson-scroll'

/** 最小假存储：能记值、能模拟抛错，不碰真 localStorage */
class FakeStorage implements ScrollStorage {
  readonly map = new Map<string, string>()
  failRead = false
  failWrite = false

  getItem(key: string): string | null {
    if (this.failRead) throw new Error('storage disabled')
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('quota exceeded')
    this.map.set(key, value)
  }

  removeItem(key: string): void {
    if (this.failWrite) throw new Error('quota exceeded')
    this.map.delete(key)
  }
}

describe('lesson-scroll', () => {
  it('键名就是主人指定的 miai_lesson_scroll_<课号>', () => {
    expect(lessonScrollKey('common-01')).toBe('miai_lesson_scroll_common-01')
    expect(lessonScrollKey('common-01').startsWith(LESSON_SCROLL_PREFIX)).toBe(true)
  })

  it('没存过 / 空课号 / 存储不存在 → 0（从头读）', () => {
    const s = new FakeStorage()
    expect(readLessonScroll(s, 'common-01')).toBe(0)
    expect(readLessonScroll(s, '')).toBe(0)
    expect(readLessonScroll(null, 'common-01')).toBe(0)
    expect(readLessonScroll(undefined, 'common-01')).toBe(0)
  })

  it('存进去再读出来是同一个整数（小数向下取整）', () => {
    const s = new FakeStorage()
    expect(writeLessonScroll(s, 'c-1', 1234.9)).toBe(true)
    expect(readLessonScroll(s, 'c-1')).toBe(1234)
  })

  it('坏值：负数 / NaN / 空串 / 非数字 → 0，不把坏值交给 scrollTo', () => {
    const s = new FakeStorage()
    for (const raw of ['-5', 'NaN', '', '12px', 'Infinity']) {
      s.map.set(lessonScrollKey('c-1'), raw)
      expect(readLessonScroll(s, 'c-1')).toBe(0)
    }
  })

  it('滚到顶（<=0）删除键，不留一条无意义的 0', () => {
    const s = new FakeStorage()
    writeLessonScroll(s, 'c-1', 800)
    expect(readLessonScroll(s, 'c-1')).toBe(800)
    expect(writeLessonScroll(s, 'c-1', 0)).toBe(true)
    expect(s.map.has(lessonScrollKey('c-1'))).toBe(false)
    expect(readLessonScroll(s, 'c-1')).toBe(0)
  })

  it('写非法值返回 false 且保留旧值 —— 一次坏读数不许抹掉读到一半的位置', () => {
    const s = new FakeStorage()
    writeLessonScroll(s, 'c-1', 800)
    expect(writeLessonScroll(s, 'c-1', Number.NaN)).toBe(false)
    expect(writeLessonScroll(s, 'c-1', Number.POSITIVE_INFINITY)).toBe(false)
    expect(readLessonScroll(s, 'c-1')).toBe(800)
  })

  it('存储抛错（隐私模式 / 配额满）不把异常抛给调用方', () => {
    const s = new FakeStorage()
    s.failRead = true
    expect(readLessonScroll(s, 'c-1')).toBe(0)
    s.failRead = false
    s.failWrite = true
    expect(writeLessonScroll(s, 'c-1', 500)).toBe(false)
  })

  it('恢复前按当前可滚高度夹住，不无限等一个到不了的位置', () => {
    expect(clampScrollTop(1800, 1200)).toBe(1200)
    expect(clampScrollTop(600, 1200)).toBe(600)
    expect(clampScrollTop(600, 0)).toBe(0)
    expect(clampScrollTop(-1, 1200)).toBe(0)
    expect(clampScrollTop(Number.NaN, 1200)).toBe(0)
    expect(clampScrollTop(120.9, 1200.8)).toBe(120)
  })

  it('两个课号互不影响（同一台电脑上每课各记各的）', () => {
    const s = new FakeStorage()
    writeLessonScroll(s, 'c-1', 300)
    writeLessonScroll(s, 'c-2', 900)
    expect(readLessonScroll(s, 'c-1')).toBe(300)
    expect(readLessonScroll(s, 'c-2')).toBe(900)
  })
})
