/**
 * challenge.json 的写入与读取（src/main/store/challenge-merge.ts）
 *
 * 【这个文件在守什么】
 * 守两件不报错、只是悄悄变坏的事：
 *
 *   1. **文件无限长大**。days 是按日期存的，一天一条，几年下来是个无底洞。
 *      裁剪放在 main 侧（渲染进程只关心「今天」），这里是最容易验的地方。
 *   2. **一条坏数据把整个挑战页打死**。存档是磁盘上的 JSON，用户可能手改，
 *      也可能被断电截断。读的时候必须**能跳过坏的那一条**，
 *      而不是让 getChallenge 抛错、挑战页直接打不开。
 */

import { describe, expect, it } from 'vitest'
import {
  assertChallengeDay,
  challengeToday,
  getChallengeDay,
  mergeChallengeDay
} from '../challenge-merge'
import { CHALLENGE_KEEP_DAYS, type ChallengeDay, type ChallengeRecord } from '../../../shared/types'

function makeDay(dateKey: string, over: Partial<ChallengeDay> = {}): ChallengeDay {
  return {
    dateKey,
    source: 'local',
    questions: [{ key: 'common-01:q1', lessonId: 'common-01', qid: 'q1' }],
    createdAt: `${dateKey}T10:00:00.000Z`,
    finishedAt: null,
    score: null,
    ...over
  }
}

/** 第 i 道题（够拼出「多题批次」的夹具用；内容本体不在这层管） */
function mkQ(i: number): ChallengeDay['questions'][number] {
  return { key: `common-01:q${i}`, lessonId: 'common-01', qid: `q${i}` }
}

// ---------------------------------------------------------------- 30 天滚动窗口

describe('写入时裁掉 30 天以外的（文件不能无限长大）', () => {
  it('第 30 天**还在**，第 31 天没了 —— 边界就是 30，不是 29 也不是 31', () => {
    const today = '2026-09-30'
    let rec: ChallengeRecord | null = null
    // 灌 40 天进去，每天一条
    for (let i = 0; i < 40; i++) {
      const d = new Date(2026, 8, 30 - i) // 9 月 30 日往回数
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      rec = mergeChallengeDay(rec, makeDay(key), today)
    }
    const keys = Object.keys(rec!.days).sort()
    expect(keys).toContain('2026-09-30') // 今天
    expect(keys).toContain('2026-09-01') // 第 30 天（含今天）
    expect(keys).not.toContain('2026-08-31') // 第 31 天
    expect(keys.length).toBe(CHALLENGE_KEEP_DAYS)
  })

  it('同一段日期用**本地时间**算，跨月不会错一天', () => {
    // 2026-03-01 往回 30 天落在 1 月，裁剪后剩下的第一天应该是 2026-01-31
    let rec: ChallengeRecord | null = null
    for (let i = 0; i <= 35; i++) {
      const d = new Date(2026, 2, 1 - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      rec = mergeChallengeDay(rec, makeDay(key), '2026-03-01')
    }
    const keys = Object.keys(rec!.days).sort()
    expect(keys[0]).toBe('2026-01-31')
    expect(keys[keys.length - 1]).toBe('2026-03-01')
  })

  it('空档案上写第一天的结果：只有这一天', () => {
    const rec = mergeChallengeDay(null, makeDay('2026-09-13'), '2026-09-13')
    expect(Object.keys(rec.days)).toEqual(['2026-09-13'])
    expect(rec.version).toBe(1)
  })

  it('写同一天两次是覆盖，不是追加（重做一次不该出现两条）', () => {
    const a = mergeChallengeDay(null, makeDay('2026-09-13'), '2026-09-13')
    const b = mergeChallengeDay(
      a,
      makeDay('2026-09-13', { finishedAt: '2026-09-13T11:00:00.000Z' }),
      '2026-09-13'
    )
    expect(Object.keys(b.days)).toHaveLength(1)
    expect(b.days['2026-09-13'].finishedAt).toBe('2026-09-13T11:00:00.000Z')
  })

  it('写新的一天不会动到旧的那天', () => {
    const a = mergeChallengeDay(null, makeDay('2026-09-12'), '2026-09-13')
    const b = mergeChallengeDay(a, makeDay('2026-09-13'), '2026-09-13')
    expect(b.days['2026-09-12']).toEqual(a.days['2026-09-12'])
  })
})

// ---------------------------------------------------------------- 坏数据不许炸

describe('坏数据：读的时候跳过，写的时候拒绝', () => {
  it('**写**的时候形状不对要抛错（程序员错误，不能悄悄写进去）', () => {
    expect(() => mergeChallengeDay(null, makeDay('不是日期'), '2026-09-13')).toThrow()
  })

  it('dateKey 必须是 YYYY-MM-DD —— 拼错一个字符就拒绝', () => {
    expect(() => assertChallengeDay(makeDay('2026-9-13'))).toThrow() // 月份没补零
    expect(() => assertChallengeDay(makeDay('20260913'))).toThrow()
    expect(() => assertChallengeDay(makeDay('2026-09-13 '))).toThrow()
  })

  it('source 只能是 local / ai', () => {
    expect(() =>
      assertChallengeDay({ ...makeDay('2026-09-13'), source: 'gpt' })
    ).toThrow()
  })

  it('score 答对数不能多于总题数（写反了会造成「答对 7 / 5 题」）', () => {
    expect(() =>
      assertChallengeDay(makeDay('2026-09-13', { score: { correct: 7, total: 5 } }))
    ).toThrow()
    expect(() =>
      assertChallengeDay(makeDay('2026-09-13', { score: { correct: 3, total: 5 } }))
    ).not.toThrow()
  })

  it('score 积分对（2026-10-10 加权制）：负数 / 非整数 / points > pointsMax 一律拒绝', () => {
    const withScore = (score: ChallengeDay['score']): ChallengeDay =>
      makeDay('2026-09-13', { score })
    // 负数：两个字段各来一条，防止只查了其中一个
    expect(() =>
      assertChallengeDay(withScore({ correct: 1, total: 2, points: -1, pointsMax: 10 }))
    ).toThrow()
    expect(() =>
      assertChallengeDay(withScore({ correct: 1, total: 2, points: 5, pointsMax: -1 }))
    ).toThrow()
    // 非整数：加权算出来都是整数分，出现小数说明拼错了
    expect(() =>
      assertChallengeDay(withScore({ correct: 1, total: 2, points: 1.5, pointsMax: 10 }))
    ).toThrow()
    expect(() =>
      assertChallengeDay(withScore({ correct: 1, total: 2, points: 5, pointsMax: 10.5 }))
    ).toThrow()
    // 得分比满分还高 —— 界面上就是「650 / 600 分」这种东西
    expect(() =>
      assertChallengeDay(withScore({ correct: 2, total: 2, points: 11, pointsMax: 10 }))
    ).toThrow()
    // 只给一个 = 给不出自洽的一对 → 拒绝（缺的那个是 undefined，不许拿 0 顶）
    expect(() => assertChallengeDay(withScore({ correct: 1, total: 2, points: 5 }))).toThrow()
    expect(() => assertChallengeDay(withScore({ correct: 1, total: 2, pointsMax: 10 }))).toThrow()
    // 自洽的一对放行；全对全拿（points === pointsMax 边界）也放行
    expect(() =>
      assertChallengeDay(withScore({ correct: 1, total: 2, points: 5, pointsMax: 10 }))
    ).not.toThrow()
    expect(() =>
      assertChallengeDay(withScore({ correct: 2, total: 2, points: 10, pointsMax: 10 }))
    ).not.toThrow()
    // 两个都没有 = 积分制改版前存下的老批次，照读（老数据不能因为新规矩打不开）
    expect(() => assertChallengeDay(withScore({ correct: 1, total: 2 }))).not.toThrow()
  })

  it('answers 是 questions 的**前缀**：答错即停之后「答的比题少」是合法状态', () => {
    // 3 题只答了 2 道（第 2 道答错就收工）—— 2026-10-10 起这是**正常**存档，
    // 校验写成「长度必须相等」的话，每一次答错即停的批次都会被自己拒绝
    expect(() =>
      assertChallengeDay(
        makeDay('2026-09-13', {
          questions: [mkQ(1), mkQ(2), mkQ(3)],
          answers: [
            { your: 0, ok: true },
            { your: 1, ok: false }
          ],
          score: { correct: 1, total: 2, points: 110, pointsMax: 220 }
        })
      )
    ).not.toThrow()
  })

  it('answers 比 questions 还长 → 拒绝（多出来的作答没有对应的题）', () => {
    expect(() =>
      assertChallengeDay(
        makeDay('2026-09-13', {
          questions: [mkQ(1)],
          answers: [
            { your: 0, ok: true },
            { your: 1, ok: false }
          ]
        })
      )
    ).toThrow()
  })

  it('score.total 与 answers.length 交叉核对：打架 = 这条数据拼错了', () => {
    const base = {
      questions: [mkQ(1), mkQ(2), mkQ(3)],
      answers: [
        { your: 0, ok: true },
        { your: 1, ok: false },
        { your: 2, ok: true }
      ]
    }
    // finish 写口两个数同源（都出自截断后的会话），对不上必是坏数据
    expect(() =>
      assertChallengeDay(makeDay('2026-09-13', { ...base, score: { correct: 1, total: 2 } }))
    ).toThrow()
    expect(() =>
      assertChallengeDay(makeDay('2026-09-13', { ...base, score: { correct: 1, total: 3 } }))
    ).not.toThrow()
    // 没有 answers 的老批次（逐题回顾上线前）不受这条管
    expect(() =>
      assertChallengeDay(makeDay('2026-09-13', { score: { correct: 1, total: 2 } }))
    ).not.toThrow()
  })

  it('没作答还判「对」→ 拒绝（回顾页会显示「你答对了」却拿不出你答的什么）', () => {
    expect(() =>
      assertChallengeDay(makeDay('2026-09-13', { answers: [{ your: null, ok: true }] }))
    ).toThrow()
    // 没作答判「错」是合法的（跳过了 / 放弃了）
    expect(() =>
      assertChallengeDay(makeDay('2026-09-13', { answers: [{ your: null, ok: false }] }))
    ).not.toThrow()
  })

  it('pickedLangs（v3 契约字段，选填）：合法子集通过；common / 协议外 / 重复 / 非数组一律拒绝', () => {
    // 选填：v2 老批次没有这个字段，照读
    expect(() => assertChallengeDay(makeDay('2026-09-13'))).not.toThrow()
    // 合法：协议内语言的子集（按声明序）
    expect(() =>
      assertChallengeDay({ ...makeDay('2026-09-13'), pickedLangs: ['c', 'java'] })
    ).not.toThrow()
    // 四门全选是合法上界
    expect(() =>
      assertChallengeDay({
        ...makeDay('2026-09-13'),
        pickedLangs: ['c', 'cpp', 'java', 'python']
      })
    ).not.toThrow()
    // common 不是一门语言（它恒含、不参与勾选），不该出现在「勾了哪几门」里
    expect(() =>
      assertChallengeDay({ ...makeDay('2026-09-13'), pickedLangs: ['common'] })
    ).toThrow()
    // 协议外的语言名
    expect(() =>
      assertChallengeDay({ ...makeDay('2026-09-13'), pickedLangs: ['golang'] })
    ).toThrow()
    // 重复：同一门语言出现两次说明调用方拼错了
    expect(() =>
      assertChallengeDay({ ...makeDay('2026-09-13'), pickedLangs: ['c', 'c'] })
    ).toThrow()
    // 不是数组
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), pickedLangs: 'c' })).toThrow()
  })

  it('format（存档格式版本，选填）：≥1 的整数；0 / 负数 / 小数 / 字符串一律拒绝', () => {
    // 选填：v2 老存档没有这个字段，照读（读口按缺省 = 1 处理）
    expect(() => assertChallengeDay(makeDay('2026-09-13'))).not.toThrow()
    expect(() => assertChallengeDay(makeDay('2026-09-13', { format: 1 }))).not.toThrow()
    expect(() => assertChallengeDay(makeDay('2026-09-13', { format: 2 }))).not.toThrow()
    // 0 非法（版本号从 1 起）—— 「0」和「没有这个字段」必须是两件事
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), format: 0 })).toThrow()
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), format: -1 })).toThrow()
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), format: 1.5 })).toThrow()
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), format: '2' })).toThrow()
  })

  it('submittedAt（「已提交」标记，选填）：缺省/字符串通过；别的类型一律拒绝', () => {
    // 选填：绝大多数批次（还没交付的）没有这个字段
    expect(() => assertChallengeDay(makeDay('2026-09-13'))).not.toThrow()
    expect(() =>
      assertChallengeDay(
        makeDay('2026-09-13', { submittedAt: '2026-09-13T09:00:00.000Z' })
      )
    ).not.toThrow()
    // 非字符串 = 调用方写错了。null 也是错的：null 和缺省必须是两件事
    //（缺省 = 没交付，是补交清单的判据；null 混进来会让 `== null` 检查放行一个假标记）
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), submittedAt: 123 })).toThrow()
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), submittedAt: null })).toThrow()
    expect(() => assertChallengeDay({ ...makeDay('2026-09-13'), submittedAt: {} })).toThrow()
  })

  it('**读**一条坏数据返回 null（当成今天还没抽过），不抛 —— 一条坏数据不该让挑战页打不开', () => {
    const rec: ChallengeRecord = {
      version: 1,
      days: { '2026-09-13': { dateKey: '坏的' } as unknown as ChallengeDay }
    }
    expect(getChallengeDay(rec, '2026-09-13')).toBeNull()
  })

  it('challengeToday：好日子照常收进 lastSeen，坏的那条被跳过', () => {
    const rec: ChallengeRecord = {
      version: 1,
      days: {
        '2026-09-12': makeDay('2026-09-12'),
        '2026-09-13': { dateKey: '坏的' } as unknown as ChallengeDay
      }
    }
    const t = challengeToday(rec, '2026-09-13')
    expect(t.day).toBeNull() // 今天这条是坏的
    expect(t.lastSeen['common-01:q1']).toBe('2026-09-12') // 昨天那条还在
  })

  it('档案是 null（首次运行）→ 空结果，不抛', () => {
    const t = challengeToday(null, '2026-09-13')
    expect(t.day).toBeNull()
    expect(t.lastSeen).toEqual({})
    expect(t.unsent).toEqual([])
  })
})

// -------------------------------------------- 待补交清单（P10.6 ⑤）

/**
 * `unsent` =「收工了、但『已提交』标记没写上」的批次 —— 收工 → 入队落盘之间
 * 进程没走完的那些。主进程**只报形状事实**（finishedAt 有、submittedAt 没有）；
 * 「能不能补交」（format < 2 不补）由渲染层按保守口径自己把 —— 同一份判据
 * 两边各写一遍迟早漂移。这里守的就是"形状事实"这一半。
 */
describe('待补交清单 unsent（P10.6 ⑤）', () => {
  it('收工未标记 → 含；已标记 → 不含；没收工 → 不含', () => {
    const rec: ChallengeRecord = {
      version: 1,
      days: {
        '2026-09-10': makeDay('2026-09-10', { finishedAt: '2026-09-10T09:00:00.000Z' }),
        '2026-09-11': makeDay('2026-09-11', {
          finishedAt: '2026-09-11T09:00:00.000Z',
          submittedAt: '2026-09-11T09:00:01.000Z'
        }),
        '2026-09-12': makeDay('2026-09-12') // 抽了没做完
      }
    }
    const t = challengeToday(rec, '2026-09-13')
    expect(t.unsent.map((d) => d.dateKey)).toEqual(['2026-09-10'])
  })

  it('今天那批收工未标记也进清单（当天崩溃窗口：重启当天就要补）', () => {
    const rec: ChallengeRecord = {
      version: 1,
      days: { '2026-09-13': makeDay('2026-09-13', { finishedAt: '2026-09-13T09:00:00.000Z' }) }
    }
    const t = challengeToday(rec, '2026-09-13')
    // day 与 unsent 是两份视角，同一条可以同时出现在两边（界面拿 day 显示成绩，
    // 补交通道拿 unsent 去交付 —— 互不冲突）
    expect(t.day?.dateKey).toBe('2026-09-13')
    expect(t.unsent.map((d) => d.dateKey)).toEqual(['2026-09-13'])
  })

  it('按 dateKey 升序 —— 补交顺序确定（最老的先交）', () => {
    const rec: ChallengeRecord = {
      version: 1,
      days: {
        '2026-09-12': makeDay('2026-09-12', { finishedAt: '2026-09-12T09:00:00.000Z' }),
        '2026-09-09': makeDay('2026-09-09', { finishedAt: '2026-09-09T09:00:00.000Z' }),
        '2026-09-11': makeDay('2026-09-11', { finishedAt: '2026-09-11T09:00:00.000Z' })
      }
    }
    const t = challengeToday(rec, '2026-09-13')
    expect(t.unsent.map((d) => d.dateKey)).toEqual(['2026-09-09', '2026-09-11', '2026-09-12'])
  })

  it('坏批次跳过（与 lastSeen 同一刀）：坏的那天不进清单，也不炸', () => {
    const rec: ChallengeRecord = {
      version: 1,
      days: {
        '2026-09-10': { dateKey: '坏的' } as unknown as ChallengeDay,
        '2026-09-11': makeDay('2026-09-11', { finishedAt: '2026-09-11T09:00:00.000Z' })
      }
    }
    const t = challengeToday(rec, '2026-09-13')
    expect(t.unsent.map((d) => d.dateKey)).toEqual(['2026-09-11'])
  })
})
