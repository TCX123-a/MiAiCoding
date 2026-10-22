/**
 * 练习 store 的键（stores/quiz.ts）
 *
 * 【为什么这个 store 值得测】
 * 它管着「哪道题答错了要记进错题本」「错题答对了要从错题本里消除」。
 * 这两件事全靠一个**字符串 key** 对上号：`课号:题号`。key 一旦错位，
 * 表现不是报错，而是**安静地什么都不发生** —— 错题本里永远消除不掉，
 * 或者越积越多一堆 `__wrong__:q1` 这种查不着题目的垃圾条目。
 * 手工测很难碰到（得刚好走一遍错题重做），机器一秒钟就能守住。
 *
 * 下面两条是本轮修的两个真 bug 的回归：
 *   - Bug A：随机卷的 key 必须带真实课号（不是 `__random__`）
 *   - Bug B：`restart()` 必须保留原 keys（原来在组件里解构时漏掉了）
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useQuizStore } from '../quiz'
import { useSettingsStore } from '../settings'
import { questionKey } from '../../../../shared/question-key'
import { correctAnswerOf, wrongAnswerOf } from './answer-fixture'
import { recBody, recKeys, stubMiai } from './miai-stub'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../../lib/copy'
import type { Question } from '../../../../shared/types'

function choice(id: string, stem: string, answer = 0): Question {
  return { id, type: 'choice', stem, options: ['甲', '乙'], answer, explanation: '解析' }
}

/** 把整局答完：每题都选正确选项后提交 */
function answerAll(quiz: ReturnType<typeof useQuizStore>, correct: boolean) {
  const s = quiz.session!
  for (let i = 0; i < s.questions.length; i++) {
    const q = quiz.current!
    // 按题型取"正确作答"：原来这里写的是 `(q as { answer: number }).answer`，
    // 只对选择题成立。见 ./answer-fixture.ts
    quiz.answerCurrent(correct ? correctAnswerOf(q) : wrongAnswerOf(q))
    quiz.submit()
    if (i < s.questions.length - 1) quiz.next()
  }
  quiz.finish()
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubMiai()
})

describe('startQuiz：key 从哪来', () => {
  it('不传 keys 时用传入的 lessonId 拼', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一'), choice('q2', '二')])
    expect(quiz.session!.keys).toEqual(['common-01:q1', 'common-01:q2'])
  })

  it('传了 keys 就用传进来的（错题重做靠这个）', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一')], ['python-03:q9'])
    expect(quiz.session!.keys).toEqual(['python-03:q9'])
  })

  it('每题各自对号入座 —— keys[i] 就是 questions[i] 的键', () => {
    const quiz = useQuizStore()
    const qs = [choice('q1', '一'), choice('q2', '二'), choice('q3', '三')]
    const keys = ['a:q1', 'b:q2', 'c:q3']
    quiz.startQuiz('wrong', '__wrong__', qs, keys)
    const s = quiz.session!
    expect(s.keys.length).toBe(s.questions.length)
    // 断言的是「配对关系」，不是对象身份：写 `expect(q).toBe(qs[i])` 会失败 ——
    // Vue 的 ref() 把整个 session 包成了 Proxy，取出来的对象和原对象身份不同。
    // 代理不影响字段值，所以按内容比。
    s.questions.forEach((q, i) => {
      expect(q.id).toBe(qs[i].id)
      expect(q.stem).toBe(qs[i].stem)
      expect(s.keys[i]).toBe(keys[i])
    })
  })
})

describe('Bug A 回归：随机卷的 key 必须带真实课号', () => {
  it('池子带上宿主课号后，随机卷的 key 不再是 __random__ 开头', () => {
    const quiz = useQuizStore()
    // 模拟 PracticeView 修好之后的写法：questions 和 keys 来自同一次挑选
    const picked = [
      { lessonId: 'common-01', q: choice('q1', '一') },
      { lessonId: 'common-02', q: choice('q1', '二') }
    ]
    quiz.startQuiz(
      'random',
      '__random__',
      picked.map((p) => p.q),
      picked.map((p) => questionKey(p.lessonId, p.q.id))
    )
    expect(quiz.session!.keys).toEqual(['common-01:q1', 'common-02:q1'])
    for (const k of quiz.session!.keys) expect(k.startsWith('__random__')).toBe(false)
  })

  it('两门课的 q1 拿到的是两个不同的 key（不会张冠李戴）', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('random', '__random__', [choice('q1', '一'), choice('q1', '二')], [
      questionKey('common-01', 'q1'),
      questionKey('common-02', 'q1')
    ])
    expect(new Set(quiz.session!.keys).size).toBe(2)
  })
})

describe('Bug B 回归：重开一局必须留住原 key', () => {
  it('restart() 之后 keys 原样不动', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一'), choice('q2', '二')], [
      'python-03:q9',
      'java-08:q4'
    ])
    quiz.restart()
    expect(quiz.session!.keys).toEqual(['python-03:q9', 'java-08:q4'])
  })

  it('重开后答对，消除的是**原来那道错题**的 key（这才是修好的标准）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一'), choice('q2', '二')], [
      'python-03:q9',
      'java-08:q4'
    ])

    quiz.restart() // ← 用户点了「再练一次」
    answerAll(quiz, true) // 这次全答对
    await Promise.resolve() // 等 finish() 里那两个 fire-and-forget 的调用落地

    // 修复前：这里会变成 ['__wrong__:q1','__wrong__:q2']，原错题永远消除不掉
    expect(log.cleared.flat()).toEqual(['python-03:q9', 'java-08:q4'])
    expect(recKeys(log)).toEqual([]) // 全答对了不该新增错题
  })

  it('重开后仍然答错，记的是原 key 且不会写进 __wrong__ 垃圾', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一', 0)], ['python-03:q9'])
    quiz.restart()
    answerAll(quiz, false)
    await Promise.resolve()

    expect(recKeys(log)).toEqual(['python-03:q9'])
    expect(recKeys(log).some((k) => k.startsWith('__wrong__'))).toBe(false)
    expect(log.cleared.flat()).toEqual([])
  })

  it('重开后题目、模式、进度都回到开头，但题目内容不变', () => {
    const quiz = useQuizStore()
    const qs = [choice('q1', '一'), choice('q2', '二')]
    quiz.startQuiz('wrong', '__wrong__', qs, ['a:q1', 'b:q2'])
    quiz.answerCurrent(0)
    quiz.submit()
    quiz.next()
    expect(quiz.session!.index).toBe(1)

    quiz.restart()
    expect(quiz.session!.index).toBe(0)
    expect(quiz.session!.mode).toBe('wrong')
    expect(quiz.session!.questions).toEqual(qs)
    expect(quiz.session!.answers).toEqual([null, null])
    expect(quiz.session!.checked).toEqual([false, false])
    expect(quiz.session!.finishedAt).toBeNull()
  })

  it('没有会话时 restart() 什么都不做，不抛错', () => {
    const quiz = useQuizStore()
    expect(quiz.session).toBeNull()
    expect(() => quiz.restart()).not.toThrow()
    expect(quiz.session).toBeNull()
  })
})

describe('判分与错题本记账', () => {
  it('答错的题按各自 key 记进错题本', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('random', '__random__', [choice('q1', '一', 0), choice('q2', '二', 0)], [
      'common-01:q1',
      'common-02:q2'
    ])
    answerAll(quiz, false)
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['common-01:q1', 'common-02:q2'])
  })

  it('非 wrong 模式答对**不**触发消除（消除只属于错题重做）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一')])
    answerAll(quiz, true)
    await Promise.resolve()
    expect(log.cleared.flat()).toEqual([])
    expect(recKeys(log)).toEqual([])
  })

  it('没提交过的题不参与记账（半途退出不该误判）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一'), choice('q2', '二')])
    quiz.answerCurrent(0)
    quiz.submit()
    quiz.finish() // 第二题压根没答
    await Promise.resolve()
    expect(recKeys(log)).toEqual([]) // 第一题答对了，第二题没提交 → 一条都不记
  })
})

/*
 * 2026-10-01 主人实测：「答错了题，错题没有自动进错题本」。
 *
 * 根因：记账原先只有 finish() 一个落点（=「最后一题点下一题」才触发），
 * ✕ 中途退出走的 close() 一行都不记 —— 探针复现（`_wbprobe-20261001`）
 * 里提交+退出全程 wrongbook 零写盘。修法：`submit()` 提交即记（同步判分题
 * 提交即锁、判定即最终态）+ `close()` 半场补账，两条路都过 Set 去重。
 * 下面逐条钉住这个语义，以及它**没有**动到的边界（练习史、未交的题）。
 */
describe('提交即记 + 半场退出补账（2026-10-01 实测回归）', () => {
  it('★ 答错后**提交那一刻**就进错题本（不等下一题、不等收尾）', () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0), choice('q2', '二', 0)])
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit()
    // 没 next、没 finish —— 账已经在（stub 的 push 是同步的，这里断言的就是"此刻"）
    expect(recKeys(log)).toEqual(['common-01:q1'])
  })

  it('★ 答错一题就 ✕ 退出：错题在，练习史不在（半场不记练习史的口径不变）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0), choice('q2', '二', 0)])
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit()
    quiz.close()
    await Promise.resolve()

    expect(recKeys(log)).toEqual(['common-01:q1']) // 错题：记上了
    expect(log.practice).toEqual([]) // 练习史：半场不记
    expect(quiz.session).toBeNull()
  })

  it('★ 半场退出**只记交过的题** —— 没答的题不许被写成一错', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一'), choice('q2', '二')])
    quiz.answerCurrent(correctAnswerOf(quiz.current!)) // q1 答对
    quiz.submit()
    quiz.next() // 翻到 q2，什么都不答
    quiz.close()
    await Promise.resolve()
    expect(recKeys(log)).toEqual([]) // 答对的不记、没答的更不记
  })

  it('★ 收尾不会把提交时记过的再记一遍（提交快路径 + 收尾补账 = 只送一次）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0)])
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit() // 提交即记（第 1 批）
    quiz.next() // 最后一题 → finish() → 兜底再过一遍
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['common-01:q1']) // 还是一条
    expect(log.recorded.flat()).toHaveLength(1) // 连批次都没多
  })

  it('★ 半场 close 补了账，但**不设 finishedAt**（残卷不许被当成完卷走结算）', () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('challenge', '__challenge__', [choice('q1', '一', 0)])
    const s = quiz.session!
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit()
    quiz.close()
    // close 之后 session 引用已置空，但上面抓着的代理还在 —— 它身上没有 finishedAt
    expect(s.finishedAt).toBeNull()
    expect(recKeys(log)).toEqual(['__challenge__:q1']) // 挑战里交过的错题同样记
  })

  it('★ wrong 模式半场答对也照样消除（消除和记错走同一条快路径）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一'), choice('q2', '二')], [
      'python-03:q9',
      'java-08:q4'
    ])
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    quiz.close()
    await Promise.resolve()
    expect(log.cleared.flat()).toEqual(['python-03:q9'])
  })

  it('★ 新一局从头记（去重是会话级的，新开局的同样的题能重新送）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    const qs = [choice('q1', '一', 0)]
    quiz.startQuiz('wrong', '__wrong__', qs, ['python-03:q9'])
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit() // 记一次
    quiz.close() // 半场退出（账已在）
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['python-03:q9'])

    // 新一局（restart 走的也是 startQuiz，Set 在这里清空）——再错一次就该再送一次，
    // 由主进程 mergeWrongRecord 把 wrongCount 累上去。去重**绝不能**跨局吃掉这次。
    quiz.startQuiz('wrong', '__wrong__', qs, ['python-03:q9'])
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit()
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['python-03:q9', 'python-03:q9'])
  })
})

/*
 * 记账失败不许静默（2026-10-01 对抗复核抓的修复）：
 * recordWrongbook / clearWrongbook 被主进程拒掉时，key 在发送**之前**就已
 * 占位在去重表里 —— 失败不回滚的话，收尾补账会被自己的去重挡掉，这一局
 * 永远没有第二次机会，而退出弹窗还写着"答错的题会照常进错题本"（假话）。
 * 现在：失败 → 把 key 删回去重表 + 弹一句提示 → finish/close 的补账真的重试。
 */
describe('记账失败：回滚去重表、收尾补账会重试（2026-10-01 复核加固）', () => {
  it('★ 提交时收录失败：弹失败提示 + 退出补账真的重发一次', async () => {
    const log = stubMiai({ failRecord: true })
    toasts.length = 0
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0)])
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit()
    await new Promise((r) => setTimeout(r, 0)) // 让拒绝的 catch 跑完

    // 失败必须吭声（不许静默吞）
    expect(toasts.at(-1)?.text).toBe(TOAST.WRONGBOOK_WRITE_FAILED)
    expect(toasts.at(-1)?.type).toBe('error')
    expect(log.recorded).toHaveLength(1) // 发过一次（被主进程拒了）

    log.failRecord = false // 主进程"恢复"了
    quiz.close() // 半场退出 → 收尾补账
    await new Promise((r) => setTimeout(r, 0))

    // 重试真的发生：同一批 key 又发了一次。若失败时没回滚去重表，
    // 这里会停在 1（收尾被自己刚占的位挡掉）—— 那正是复核发现的原缺陷
    expect(log.recorded).toHaveLength(2)
    expect(recKeys(log)).toEqual(['common-01:q1', 'common-01:q1'])
    expect(log.recorded[1]).toEqual(log.recorded[0]) // 重发的是同一批，不是另一批
    // 重试成功不产生新提示（这局只该有一条"没记上"）
    expect(toasts).toHaveLength(1)
  })

  it('★ 消除失败：同样回滚，收尾补账重发（不弹提示 —— 它在错题本里看得见）', async () => {
    const log = stubMiai({ failClear: true })
    toasts.length = 0
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一')], ['python-03:q9'])
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    await new Promise((r) => setTimeout(r, 0))
    expect(log.cleared).toHaveLength(1)
    expect(toasts).toHaveLength(0)

    log.failClear = false
    quiz.close()
    await new Promise((r) => setTimeout(r, 0))
    expect(log.cleared).toHaveLength(2)
    expect(log.cleared[1]).toEqual(log.cleared[0])
  })

  it('★ 失败后同一局的下一次提交就会重试（不必等到收尾）', async () => {
    const log = stubMiai({ failRecord: true })
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0), choice('q2', '二', 0)])
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit() // q1 第一次发（被拒）
    await new Promise((r) => setTimeout(r, 0))
    log.failRecord = false
    quiz.next()
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit() // q2 提交 → flush 重扫全卷：q1 已回滚，跟着这一批一起重发
    await new Promise((r) => setTimeout(r, 0))
    expect(log.recorded).toHaveLength(2)
    expect(recKeys(log)).toEqual(['common-01:q1', 'common-01:q1', 'common-01:q2'])
  })
})

/*
 * 错题毕业计数（V1-26）：
 * wrong 模式答对一道错题 = 它从错题本毕业。以前这件事**只在错题本里看得见** ——
 * 学员在错题重做里全答对了，结果页只说"答对 N/N"，错题本是不是轻了、得自己
 * 再点进去数（审查意见的原文就是"错题毕业静默"）。
 *
 * 口径钉两条，都在下面：
 *   ① 计数发生在**写盘成功之后**（失败→回滚→补账成功那次也照样入账）
 *   ② 是**累加**不是赋值（"提交即记"以后一局里 flushWrongbook 会跑多次）
 * 界面行（QuizOverlay 的 result-graduated）读的就是这个数；0 不显示。
 */
describe('错题毕业计数（V1-26）：写盘成功才入账、多批累加', () => {
  it('★ 答对一道错题：写盘成功后 lastCleared 变 1', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一')], ['python-03:q9'])
    expect(quiz.session!.lastCleared).toBe(0) // 新局从 0 起
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit() // 提交即记
    await new Promise((r) => setTimeout(r, 0))
    expect(log.cleared).toEqual([['python-03:q9']])
    expect(quiz.session!.lastCleared).toBe(1)
  })

  it('★ 写盘失败不入账；补账成功那次才入账（会话对象被 close 摘掉也读得到）', async () => {
    const log = stubMiai({ failClear: true })
    const quiz = useQuizStore()
    quiz.startQuiz('wrong', '__wrong__', [choice('q1', '一')], ['python-03:q9'])
    const s = quiz.session! // 先抓住对象：close() 会把 store 上的 session 置空
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    await new Promise((r) => setTimeout(r, 0))
    expect(log.cleared).toHaveLength(1) // 发过（被主进程拒了）
    expect(s.lastCleared).toBe(0) // ← 没写盘就不算毕业：结果页那行不许出现

    log.failClear = false
    quiz.close() // 半场退出 → 收尾补账（失败时回滚过去重表，这次会真发）
    await new Promise((r) => setTimeout(r, 0))
    expect(log.cleared).toHaveLength(2)
    expect(s.lastCleared).toBe(1) // 补账成功也入账 —— 毕业终究是真的
  })

  it('★ 分两次提交毕业两道：累加不是覆盖（写成赋值这里会停在 1）', async () => {
    stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz(
      'wrong',
      '__wrong__',
      [choice('q1', '一'), choice('q2', '二')],
      ['python-03:q9', 'python-03:q10']
    )
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    await new Promise((r) => setTimeout(r, 0))
    quiz.next()
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    await new Promise((r) => setTimeout(r, 0))
    quiz.finish() // 收尾补账这次没有新 key（去重表挡着），数字不动
    expect(quiz.session!.lastCleared).toBe(2)
  })

  it('课内练习答对不涨：毕业是 wrong 模式独有的语义', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一')])
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    await new Promise((r) => setTimeout(r, 0))
    expect(log.cleared).toHaveLength(0) // 一道消除都没送
    expect(quiz.session!.lastCleared).toBe(0)
  })
})

/*
 * 练习史（`practice:record`）：每日复习的加权真源。
 *
 * 【为什么这几条要这么细】它和错题本走的是**同一段代码**，但跳题口径不同：
 * 错题本只要"错的那些"，练习史要**所有交过的**（答对的也得记，否则
 * `(错+1)/(尝试+2)` 里的分母永远是 0，凡出现过的课都被判成重灾区）。
 * 口径混了不会报错，只会让复习页出的题悄悄偏 —— 所以逐条钉住。
 */
describe('练习史：只记**交过**的题，对错如实', () => {
  it('★ 交过的题一条不落，对错和 key 逐条对上', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('random', '__random__', [choice('q1', '一', 0), choice('q2', '二', 0)], [
      'common-01:q1',
      'common-02:q2'
    ])
    // 第一题答对、第二题答错 —— 两个方向都要有，否则"ok 恒等于某一个值"的
    // 实现（比如把 ok 写死 false）也能过
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    quiz.next()
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit()
    quiz.finish()
    await Promise.resolve()

    expect(log.practice).toHaveLength(1)
    expect(log.practice[0].mode).toBe('random')
    expect(log.practice[0].items).toEqual([
      { key: 'common-01:q1', ok: true },
      { key: 'common-02:q2', ok: false }
    ])
  })

  it('★ 没交过的题**不进练习史** —— 写成 ok:false 等于替他记一次错答', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一'), choice('q2', '二')])
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    quiz.finish() // 第二题压根没答
    await Promise.resolve()

    // 错题本那边一条都没有（答对了），练习史这边**有且只有第一题**
    expect(log.practice[0].items).toEqual([{ key: 'common-01:q1', ok: true }])
  })

  it('★ 一题都没交 → 压根不发这次请求（别造一条空的练习）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一')])
    quiz.finish()
    await Promise.resolve()
    expect(log.practice).toEqual([])
  })

  it('★ 收藏练习关掉错题开关时，练习史**照样记**（两件事的口径不同）', async () => {
    /*
     * 这条钉的是一个"顺手就会写出来"的 bug：把记练习史塞进错题本那个循环里。
     * 那个循环里有 `if (!recordWrong) return` —— 开关一关，
     * 练习史也跟着停，而用户完全不知道"我关掉的开关还管着复习权重"。
     */
    const log = stubMiai()
    useSettingsStore().config.favWrongToBook = false
    const quiz = useQuizStore()
    quiz.startQuiz('fav', '__fav__', [choice('q1', '一', 0)], ['c-stage1-01:q1'])
    answerAll(quiz, false)
    await Promise.resolve()

    expect(recKeys(log)).toEqual([]) // 错题本：一条都没记
    expect(log.practice[0].mode).toBe('fav') // 练习史：照样记，而且模式如实
    expect(log.practice[0].items).toEqual([{ key: 'c-stage1-01:q1', ok: false }])
  })

  it('★ 阶段 / 整门卷：mode 如实、key 是各题**自己那节课**的（不是哨兵）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('stage', '__stage__', [choice('q1', '一', 0)], ['c-stage1-03:q1'])
    answerAll(quiz, true)
    await Promise.resolve()

    expect(log.practice[0].mode).toBe('stage')
    expect(log.practice[0].items).toEqual([{ key: 'c-stage1-03:q1', ok: true }])
    // 哨兵课号进了库，复习的加权就是对着"一门不存在的课"统计
    expect(log.practice[0].items.every((it) => !it.key.includes('__'))).toBe(true)
  })
})

describe('AI 出的题也进错题本，但**必须带着本体**（主人 2026-09-13 拍板改的规矩）', () => {
  it('答错 AI 题：收，而且**题目本体一起送过去**', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    const aiKey = questionKey('common-01', 'ai-2026-09-13-1')
    const q = choice('ai-2026-09-13-1', 'AI 出的题', 0)
    quiz.startQuiz('random', '__random__', [q], [aiKey])
    answerAll(quiz, false)
    await Promise.resolve()

    expect(recKeys(log)).toEqual([aiKey])
    // 【这条是整个改动的地基】
    // 光有 key 的话，错题本里就是一条**永远消除不掉的死条目**：
    // 题干显示成「题目已被移走喵」，点重做被静默跳过，答对了也消除不掉。
    // 因为 AI 题不在任何一课里，去内容包按「课号+题号」永远找不回来
    expect(recBody(log, aiKey)).toEqual(q)
  })

  it('内置题**不带**本体 —— 带了就是第二份真源', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '内置题', 0)])
    answerAll(quiz, false)
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['common-01:q1'])
    // 内容包里就有这道题。存一份到错题本里，将来改了内置题，
    // 错题本里那份还是旧的，同一个坑在 ChallengeQuestion 那边已经交代过
    expect(recBody(log, 'common-01:q1')).toBeUndefined()
  })

  it('**载荷能过结构化克隆** —— 题目本体是从 store 上读出来的响应式代理', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz(
      'random',
      '__random__',
      [choice('ai-2026-09-13-1', 'AI 出的题', 0)],
      [questionKey('common-01', 'ai-2026-09-13-1')]
    )
    answerAll(quiz, false)
    await Promise.resolve()
    // 不做 toIpc 的话，上面那个 structuredClone 会当场抛，被 finish() 的 catch 吞掉，
    // 表现是「AI 错题一条都没记上」而界面一切正常 —— 这个坑本项目踩过三次了。
    // 反过来说：这一条能过，就等于证明载荷里没有夹带代理
    expect(log.recorded).toHaveLength(1)
    expect(recKeys(log)).toEqual(['common-01:ai-2026-09-13-1'])
  })

  it('同一局里内置题和 AI 题混着也不会串', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz(
      'random',
      '__random__',
      [choice('q1', '内置题', 0), choice('ai-2026-09-13-1', 'AI 题', 0), choice('q2', '内置题2', 0)],
      [
        questionKey('common-01', 'q1'),
        questionKey('common-01', 'ai-2026-09-13-1'),
        questionKey('common-02', 'q2')
      ]
    )
    answerAll(quiz, false)
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['common-01:q1', 'common-01:ai-2026-09-13-1', 'common-02:q2'])
    // 只有中间那条带本体，两边的内置题都不带
    expect(recBody(log, 'common-01:q1')).toBeUndefined()
    expect(recBody(log, 'common-01:ai-2026-09-13-1')).toBeDefined()
    expect(recBody(log, 'common-02:q2')).toBeUndefined()
  })

  it('错题重做时 AI 题答对了照常消除（和内置题同一套，不开特例）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz(
      'wrong',
      '__wrong__',
      [choice('ai-2026-09-13-1', 'AI 题', 0)],
      [questionKey('common-01', 'ai-2026-09-13-1')]
    )
    answerAll(quiz, true)
    await Promise.resolve()
    expect(log.cleared.flat()).toEqual(['common-01:ai-2026-09-13-1'])
    expect(recKeys(log)).toEqual([])
  })
})

// ──────────────────────────────────────────────────────────── 学习闭环 §5

describe('来源徽章：记账时带上「这次在哪错的」', () => {
  it('答错的题带 source = 本次会话的模式（内置题）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0)])
    answerAll(quiz, false)
    await Promise.resolve()
    expect(log.recorded[0][0].source).toBe('lesson')
  })

  it('AI 题同样带 source（本体 + 来源一起送）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    const key = questionKey('common-01', 'ai-2026-09-29-1')
    quiz.startQuiz('challenge', '__challenge__', [choice('ai-2026-09-29-1', 'AI 题', 0)], [key])
    answerAll(quiz, false)
    await Promise.resolve()
    const rec = log.recorded[0].find((it) => it.key === key)!
    expect(rec.source).toBe('challenge')
    expect(rec.ai).toBeDefined()
  })

  it('延展模式：答错的记入（source=extend），答对的**不**清除 —— 延展是"多练"不是"重做"', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('extend', '__extend__', [choice('q1', '一', 0), choice('q2', '二', 0)], [
      'c-stage1-02:m1',
      'c-stage1-02:m2'
    ])
    answerAll(quiz, true)
    await Promise.resolve()
    // 全对：一条不记、一条不清 —— 这就是 extend 和 wrong 的分界
    expect(recKeys(log)).toEqual([])
    expect(log.cleared.flat()).toEqual([])

    const log2 = stubMiai()
    const quiz2 = useQuizStore()
    quiz2.startQuiz('extend', '__extend__', [choice('q1', '一', 0)], ['c-stage1-02:m1'])
    answerAll(quiz2, false)
    await Promise.resolve()
    expect(recKeys(log2)).toEqual(['c-stage1-02:m1'])
    expect(log2.recorded[0][0].source).toBe('extend')
  })
})

/**
 * 收藏练习（fav）的记账三问（2026-09-29 学习闭环 §6）。
 *
 * 这是**唯一一个记账行为受设置控制**的模式：答错记不记错题由
 * `config.favWrongToBook`（默认 true）决定。所以这里除了"记不记"，
 * 还要钉住"开关关掉时**只**关掉它自己"—— 顺手把别的模式也关掉的话，
 * 用户会在课后练习里答错一堆题，然后发现一道都没进错题本。
 */
describe('收藏练习（fav）：答错看设置、答对不清除、不发奖励', () => {
  it('默认（开关开着）：答错照常记入，source = fav', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('fav', '__fav__', [choice('q1', '一', 0)], ['c-stage1-01:q1'])
    answerAll(quiz, false)
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['c-stage1-01:q1'])
    expect(log.recorded[0][0].source).toBe('fav')
  })

  it('★ 开关关掉：一条都不记（这条钉的是设置真的被读了）', async () => {
    const log = stubMiai()
    useSettingsStore().config.favWrongToBook = false
    const quiz = useQuizStore()
    quiz.startQuiz('fav', '__fav__', [choice('q1', '一', 0)], ['c-stage1-01:q1'])
    answerAll(quiz, false)
    await Promise.resolve()
    expect(recKeys(log)).toEqual([])
  })

  it('★ 开关只管 fav：同一次开关关着，课后练习答错照记不误', async () => {
    const log = stubMiai()
    useSettingsStore().config.favWrongToBook = false
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0)])
    answerAll(quiz, false)
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['common-01:q1'])
  })

  it('答对**不**清除（收藏练习是多练一遍，不是错题重做）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('fav', '__fav__', [choice('q1', '一', 0)], ['c-stage1-01:q1'])
    answerAll(quiz, true)
    await Promise.resolve()
    expect(recKeys(log)).toEqual([])
    expect(log.cleared.flat()).toEqual([])
  })

  it('AI 题答错：本体一起送（和别的模式同一套，不开特例）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    const key = questionKey('c-stage1-01', 'ai-2026-09-29-1')
    quiz.startQuiz('fav', '__fav__', [choice('ai-2026-09-29-1', 'AI 题', 0)], [key])
    answerAll(quiz, false)
    await Promise.resolve()
    const rec = log.recorded[0].find((it) => it.key === key)!
    expect(rec.source).toBe('fav')
    expect(rec.ai).toBeDefined()
  })
})

/**
 * 搜索微型卷（search）的记账三问（2026-09-30 学习闭环 §9）。
 * 它和 extend 同档："多练一遍"，不是"重做那道错题"。
 */
describe('搜索微型卷（search）：答错照记（source=search）、答对不清除', () => {
  it('答错：按真实课号键记入，source = search', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('search', '__search__', [choice('q1', '一', 0)], ['c-stage1-02:m1'])
    answerAll(quiz, false)
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['c-stage1-02:m1'])
    expect(log.recorded[0][0].source).toBe('search')
  })

  it('答对：不记、也不清除（搜索练习是"多练"，不是错题重做）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('search', '__search__', [choice('q1', '一', 0)], ['c-stage1-02:m1'])
    answerAll(quiz, true)
    await Promise.resolve()
    expect(recKeys(log)).toEqual([])
    expect(log.cleared.flat()).toEqual([])
  })
})

describe('删过又答错：不静默复活，弹一句「你删过的」', () => {
  it('★ 主进程报回复活名单时，弹提示（且文案带上条数）', async () => {
    stubMiai({ revived: ['common-01:q1'] })
    toasts.length = 0
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0)])
    answerAll(quiz, false)
    // finish() 里是 .then(...) —— 要等微任务链走完（recordWrongbook 的 promise 再 .then）
    await Promise.resolve()
    await Promise.resolve()
    expect(toasts.map((t) => t.text)).toContain(TOAST.wrongRevived(1))
  })

  it('复活名单为空 → 一句都不弹（这条钉的是"没复活就不许说话"）', async () => {
    stubMiai({ revived: [] })
    toasts.length = 0
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一', 0)])
    answerAll(quiz, false)
    await Promise.resolve()
    await Promise.resolve()
    expect(toasts.map((t) => t.text)).not.toContain(TOAST.wrongRevived(1))
    expect(toasts).toHaveLength(0)
  })
})

describe('patchWrongbook：手动软删 / 恢复 / 标漏洞', () => {
  it('成功：把 patch 发给主进程，并用返回的新列表换掉手里的快照', async () => {
    const next = [
      {
        key: 'common-01:q1',
        lessonId: 'common-01',
        qid: 'q1',
        wrongCount: 1,
        lastWrongAt: '2026-09-29T02:00:00.000Z',
        cleared: false,
        removed: true as const,
        removedAt: '2026-09-29T03:00:00.000Z'
      }
    ]
    const log = stubMiai({ updateResult: next })
    const quiz = useQuizStore()
    const ok = await quiz.patchWrongbook([{ key: 'common-01:q1', patch: { removed: true } }])

    expect(ok).toBe(true)
    expect(log.updates[0]).toEqual([{ key: 'common-01:q1', patch: { removed: true } }])
    // 新列表是**主进程返回的那份**（不是本地拼的）—— 界面和磁盘同一时刻同一份
    expect(quiz.wrongbook).toEqual(next)
  })

  it('失败：返回 false + 弹错误提示 + 重新从磁盘拉一次（不拿本地猜的状态糊弄）', async () => {
    const log = stubMiai({ failUpdate: true })
    toasts.length = 0
    const quiz = useQuizStore()
    quiz.wrongbook = [
      {
        key: 'common-01:q1',
        lessonId: 'common-01',
        qid: 'q1',
        wrongCount: 1,
        lastWrongAt: '2026-09-29T02:00:00.000Z',
        cleared: false
      }
    ]
    const ok = await quiz.patchWrongbook([{ key: 'common-01:q1', patch: { removed: true } }])
    // loadWrongbook 是 `void` 出去的（失败路径不等它）——给它一个宏任务把重载走完。
    // 不等的话这里会间歇性读到"删之前"的快照，红得莫名其妙
    await new Promise((r) => setTimeout(r, 0))

    expect(ok).toBe(false)
    expect(toasts.at(-1)?.text).toBe(TOAST.WRONG_UPDATE_FAILED)
    expect(toasts.at(-1)?.type).toBe('error')
    // patch 确实发出去过（不是本地直接拒绝）
    expect(log.updates).toHaveLength(1)
    // loadWrongbook 真的跑过：stub 的 getWrongbook 返回 []，重载后错题本应当是空的。
    // 不重载的话，手里那份还是上面那个"删之前"的快照 —— 用户会以为删成功了
    expect(quiz.wrongbook).toEqual([])
  })
})

/*
 * 好感度收工事件（P3 ④，2026-10-08）：每日复习**全对** → petEvent('review')。
 *
 * 【为什么这四条都要有】「什么时候算全对」在这个 store 里已经有一份定义
 * （上面 allCorrect 那个 every），好感度事件必须复用同一条判据、不许另写；
 * 而且**不多发**和**不少发**一样重要：少发 = 白学一天，多发 = 一次收工
 * 记两遍分。「没答的题不算对」这条边界在奖励那边有注释钉着，这里也钉一遍。
 */
describe('好感度收工事件：复习满分 → petEvent(review)', () => {
  it('★ review 全对：发且只发一次 review', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('review', '__review__', [choice('q1', '一'), choice('q2', '二')], [
      'common-01:q1',
      'common-02:q2'
    ])
    answerAll(quiz, true)
    await Promise.resolve()
    expect(log.petEventCalls).toEqual(['review'])
  })

  it('★ review 错一道：一次都不发（全对判据的两个方向都要量）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('review', '__review__', [choice('q1', '一'), choice('q2', '二')], [
      'common-01:q1',
      'common-02:q2'
    ])
    const s = quiz.session!
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    quiz.next()
    quiz.answerCurrent(wrongAnswerOf(quiz.current!))
    quiz.submit()
    quiz.finish()
    await Promise.resolve()
    expect(s.mode).toBe('review') // 尺子自证：跑的确实是 review 这条分支
    expect(log.petEventCalls).toEqual([])
  })

  it('★ review 有题没答就收尾：不算全对（跳过 ≠ 答对，不许刷奖励）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('review', '__review__', [choice('q1', '一'), choice('q2', '二')], [
      'common-01:q1',
      'common-02:q2'
    ])
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    quiz.finish() // q2 压根没答
    await Promise.resolve()
    expect(log.petEventCalls).toEqual([])
  })

  it('★ 非 review 模式全对：不发 review（这条事件只属于每日复习）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一'), choice('q2', '二')])
    answerAll(quiz, true)
    await Promise.resolve()
    expect(log.petEventCalls).toEqual([])
  })
})

/*
 * 奖励图的触发点（2026-10-17 主人改口径）：每日复习**整卷作答**就发一张，
 * 不再要求全对；少答一道 = 没完成这一轮，不发。
 *
 * 【这里为什么值得单独钉】这条判据就在 finish() 里一行 `every(checked)`，
 * 写错成「至少答了一题」或「答对才发」都不会报错 —— 前者能被空卷/挑题刷图，
 * 后者正是主人这次要放开的旧口径。发图本身在 stores/reward.ts 有单测，
 * 这条文件只钉**触发时机**与 perfect 旗的来路。
 */
describe('奖励图触发：整卷作答就发（2026-10-17 起不看分数）', () => {
  /** 等 finish() 里 fire-and-forget 的 grant 链走完（IPC → 换内存 → 刷新覆盖） */
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('★ review 全对：发一次，perfect=true', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('review', '__review__', [choice('q1', '一'), choice('q2', '二')], [
      'common-01:q1',
      'common-02:q2'
    ])
    answerAll(quiz, true)
    await settle()
    expect(log.grantCalls).toHaveLength(1)
    expect(log.grantPerfects).toEqual([true])
  })

  it('★ review 答错但整卷做完：照样发一次，perfect=false（这次改口径的核心）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('review', '__review__', [choice('q1', '一'), choice('q2', '二')], [
      'common-01:q1',
      'common-02:q2'
    ])
    answerAll(quiz, false) // 两题都答错，但每题都交过
    await settle()
    expect(log.grantCalls).toHaveLength(1)
    expect(log.grantPerfects).toEqual([false])
  })

  it('★ review 有题没答就收尾：一次都不发（跳过 ≠ 完成复习）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('review', '__review__', [choice('q1', '一'), choice('q2', '二')], [
      'common-01:q1',
      'common-02:q2'
    ])
    quiz.answerCurrent(correctAnswerOf(quiz.current!))
    quiz.submit()
    quiz.finish() // q2 压根没答
    await settle()
    expect(log.grantCalls).toEqual([])
  })

  it('★ 非 review 模式做完：一次都不发（发图只属于每日复习）', async () => {
    const log = stubMiai()
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-01', [choice('q1', '一'), choice('q2', '二')])
    answerAll(quiz, true)
    await settle()
    expect(log.grantCalls).toEqual([])
  })
})
