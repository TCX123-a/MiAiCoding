/**
 * 真跑题型（codefix / codewrite）的会话流程（stores/quiz.ts）
 *
 * 【为什么不和 quiz.test.ts 合成一个】
 * 那一份管的是"key 对不对得上"（错题本靠字符串对上号，key 一错就安静地不生效）。
 * 这一份管的是**另一件独立的事**：真跑题型和其余五个题型的**流程不一样** ——
 * 它们多了一次"运行"，多了一个"没跑通"的中间态，答错了还不封口。
 * 两件事各自有自己的失败方式，混在一个文件里谁都不好读。
 *
 * 【这个文件在守什么】
 * 真跑题型的中间态比别的题型多，而**每一个中间态搞错都是静默的**：
 *   · 编译失败被判成"答错" → 界面把正确答案摆出来（他一次都还没改）
 *   · 旧结果没作废 → 用上一版代码的输出判这一版代码的生死
 *   · 判定没跟着结果一起作废 → 改代码时旁边一直挂着一张错的「答错了」卡
 * 这三件事没有一件会抛错、会变红、会在日志里留痕。它们只能靠这里钉住。
 *
 * 驱动真跑的是 ./answer-fixture.ts 里造的**假 RunResult**（项目零 `vi.mock`，
 * 替身一律显式传进去）。假的只假在"结果从哪来"，判定逻辑走的是真货。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useQuizStore } from '../quiz'
import { recKeys, stubMiai } from './miai-stub'
import { runCompileError, runCrashed, runOk } from './answer-fixture'
import type { CodeFixQuestion, CodeWriteQuestion, Question } from '../../../../shared/types'

function codefix(id = 'q1', expectedOutput = '3'): CodeFixQuestion {
  return {
    id,
    type: 'codefix',
    lang: 'c',
    brokenCode: 'int main(void){ retrun 0; }',
    stem: '改对它',
    expectedOutput,
    referenceFix: 'int main(void){ return 0; }',
    explanation: '解析'
  }
}

function codewrite(id = 'q1', expectedOutput = '喵'): CodeWriteQuestion {
  return {
    id,
    type: 'codewrite',
    lang: 'python',
    stem: '打印喵',
    expectedOutput,
    referenceSolution: 'print("喵")',
    explanation: '解析'
  }
}

function choice(id = 'q1'): Question {
  return { id, type: 'choice', stem: '概念题', options: ['甲', '乙'], answer: 0, explanation: '解析' }
}

/** 起一局只有这一道题的练习 */
function start(q: Question, mode: 'lesson' | 'wrong' = 'lesson') {
  const quiz = useQuizStore()
  quiz.startQuiz(mode, 'common-12', [q], [mode === 'wrong' ? 'c-01:q9' : 'common-12:q1'])
  return quiz
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubMiai()
})

describe('canSubmit：真跑题型的门槛是"跑通过一次"', () => {
  it('**代码写了但没跑过 → 不能提交**（"非空即可交"对它们太松）', () => {
    const quiz = start(codefix())
    quiz.answerCurrent('int main(void){ return 0; }')
    expect(quiz.session!.answers[0]).not.toBe('')
    expect(quiz.canSubmit).toBe(false)
  })

  it('编译没过 → 还是不能交（"编译过、跑完、输出拿到了"才算跑通）', () => {
    const quiz = start(codefix())
    quiz.answerCurrent('int main(void){ retrun 0; }')
    quiz.recordRun(runCompileError())
    expect(quiz.canSubmit).toBe(false)
  })

  it('崩了 / 超时 → 同样不能交（`ok` 为 false 一律不算跑通）', () => {
    const quiz = start(codefix())
    quiz.recordRun(runCrashed('3'))
    expect(quiz.canSubmit).toBe(false)
  })

  it('跑通了但输出不对 → **能交**（交上去才是"答错了"，好让他继续改）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.answerCurrent('int main(void){ printf("4"); return 0; }')
    quiz.recordRun(runOk('4\n'))
    expect(quiz.canSubmit).toBe(true)
  })

  it('跑通了而且输出对、**还没交** → **能交**', () => {
    // ⚠️ 这一条原先写的是"不能交（做对了就封口）"，那是错的：
    // 封口的前提是**已经交过一次**，而"跑对了"只是"跑通了"的一种。
    // 按原来那条规则，学员代码一写对，提交按钮就灰了 —— 他永远交不了卷，
    // 屏幕上还只有一段正确的输出。这条测试现在守的是反面。
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n')) // ← 实机输出带 CRLF 也判对，见 shared/run-grading.ts
    expect(quiz.canSubmit).toBe(true)
  })

  it('答对并且交过之后 → **封口**，不能反复交（这才是"做对了就封口"）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'))
    expect(quiz.submitRun()).toBe(true)
    expect(quiz.canSubmit).toBe(false)
  })

  it('同步题型的规则一点没变（非空即可交）', () => {
    const quiz = start(choice())
    expect(quiz.canSubmit).toBe(false)
    quiz.answerCurrent('随便写点什么')
    expect(quiz.canSubmit).toBe(true)
  })
})

describe('submitRun：三态，以及"没跑通"绝不能算答错', () => {
  it('没跑过 → 返回 false，`checked` 一格不动', () => {
    const quiz = start(codefix())
    expect(quiz.submitRun()).toBe(false)
    expect(quiz.session!.checked[0]).toBe(false)
    expect(quiz.isCurrentCorrect).toBeNull() // ← 界面靠它决定要不要显示判定卡
  })

  it('**编译失败 → 返回 false，`checked` 依旧不动**（这条最要紧）', () => {
    const quiz = start(codefix())
    quiz.answerCurrent('int main(void){ retrun 0; }')
    quiz.recordRun(runCompileError())
    expect(quiz.submitRun()).toBe(false)
    // 判成"答错"的两个恶果，都在这一条上：
    //   ① 他一次都没改，就先被记进错题本了
    //   ② `checked` 一亮，QuizOverlay 就显示「应该是：3」—— 把答案告诉他了
    expect(quiz.session!.checked[0]).toBe(false)
    expect(quiz.isCurrentCorrect).toBeNull()
  })

  it('跑通且输出对 → true；跑通但输出错 → false。两种都判分（`checked` 亮）', () => {
    const right = start(codefix('q1', '3'))
    right.recordRun(runOk('3\n'))
    expect(right.submitRun()).toBe(true)
    expect(right.session!.checked[0]).toBe(true)
    expect(right.isCurrentCorrect).toBe(true)

    const wrong = start(codefix('q1', '3'))
    wrong.recordRun(runOk('4\n'))
    expect(wrong.submitRun()).toBe(false)
    expect(wrong.session!.checked[0]).toBe(true)
    expect(wrong.isCurrentCorrect).toBe(false)
  })

  it('对非真跑题型调用它 → 返回 false，什么都不改（别让它成了第二条判分路）', () => {
    const quiz = start(choice())
    quiz.answerCurrent(0) // 正确选项
    expect(quiz.submitRun()).toBe(false)
    expect(quiz.session!.checked[0]).toBe(false)
  })

  it('**输出差一个换行也算对** —— 判定走的是真货，不是这里另写的比对', () => {
    const quiz = start(codefix('q1', 'a\nb'))
    quiz.recordRun(runOk('a\r\nb\r\n'))
    expect(quiz.submitRun()).toBe(true)
  })
})

describe('改代码 = 旧结果和旧判定一起作废', () => {
  it('跑通答错后接着改代码 → 提交按钮又灰下去（逼他重跑一次）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.canSubmit).toBe(true)

    quiz.answerCurrent('int main(void){ printf("3"); return 0; }')
    expect(quiz.session!.runResults[0]).toBeNull()
    // 不清 `runResults` 的话这里还是 true，他会拿旧输出当新代码的结果提交
    expect(quiz.canSubmit).toBe(false)
  })

  it('**改代码之后那张「答错了」卡必须消失** —— 它说的是已经不存在的代码', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.isCurrentCorrect).toBe(false)

    quiz.answerCurrent('int main(void){ printf("3"); return 0; }')
    // 只清 `runResults` 不清 `checked` 的话，`verdictOf` 把"没有结果"算成 false，
    // 界面（QuizOverlay.vue:161）照 `checked` 显示那张红卡：
    // 「你写的：<他正在改的新代码>　应该是：3」—— 那就是把答案摆在他面前
    expect(quiz.session!.checked[0]).toBe(false)
    expect(quiz.isCurrentCorrect).toBeNull()
  })

  it('改回一模一样的代码也算改过（不做"内容相同就不作废"的聪明判断）', () => {
    const quiz = start(codefix('q1', '3'))
    const code = 'int main(void){ printf("3"); return 0; }'
    quiz.answerCurrent(code)
    quiz.recordRun(runOk('3\n'))
    quiz.submitRun()
    expect(quiz.session!.checked[0]).toBe(true)

    quiz.answerCurrent(code)
    expect(quiz.session!.checked[0]).toBe(false)
  })

  it('同步题型不受影响：提交过就锁住，改不动（`checked` 不归 `answerCurrent` 管）', () => {
    const quiz = start(choice())
    quiz.answerCurrent(0)
    quiz.submit()
    quiz.answerCurrent(1) // 组件里输入框已 readonly，走不到这儿；真走了也不该解锁
    expect(quiz.session!.checked[0]).toBe(true)
  })
})

describe('错题本记账：真跑题型走的是同一套', () => {
  it('跑通答错 → 收进错题本', async () => {
    const log = stubMiai()
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.finish()
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['common-12:q1'])
  })

  it('**改到一半跑了但编不过 → 一条都不记**（他还没做错任何事）', async () => {
    const log = stubMiai()
    const quiz = start(codefix())
    quiz.answerCurrent('int main(void){ retrun 0; }')
    quiz.recordRun(runCompileError())
    quiz.submitRun()
    quiz.finish()
    await Promise.resolve()
    expect(recKeys(log)).toEqual([])
  })

  it('答对 → 不记；错题重做答对 → 消除原 key（和其余题型同一套，不开特例）', async () => {
    const log = stubMiai()
    const quiz = start(codefix('q1', '3'), 'wrong')
    quiz.recordRun(runOk('3\r\n'))
    quiz.submitRun()
    quiz.finish()
    await Promise.resolve()
    expect(log.cleared.flat()).toEqual(['c-01:q9'])
    expect(recKeys(log)).toEqual([])
  })

  it('跑通答错之后**又改对并重跑** → 收工只按最后那次算', async () => {
    const log = stubMiai()
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("3"); return 0; }')
    quiz.recordRun(runOk('3\n'))
    quiz.submitRun()
    quiz.finish()
    await Promise.resolve()
    expect(recKeys(log)).toEqual([])
  })

  it('★ 真跑题**不**跟着"提交即记"：交完这一刻账上还没有它（最终态在收尾才知道）', () => {
    // 同步判分题提交即锁、判定即最终态，所以 submit() 里当场记（2026-10-01 修）；
    // 真跑题答错还能改、还能重交 —— 此刻记了就是"拿中间态记账"，
    // 上面「改对重跑只按最后那次算」那条马上会被打脸。
    const log = stubMiai()
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(recKeys(log)).toEqual([])
  })

  it('★ 交过之后 ✕ 半场退出 → 照样记（close 补账对真跑题一视同仁）', async () => {
    const log = stubMiai()
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.close()
    await Promise.resolve()
    expect(recKeys(log)).toEqual(['common-12:q1'])
  })

  it('★ 跑通了但**没交**就退出 → 不记（没交卷就不是答错，和同步题同一条口径）', async () => {
    const log = stubMiai()
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.close()
    await Promise.resolve()
    expect(recKeys(log)).toEqual([])
  })
})

describe('错了几次：管的是"我们什么时候主动开口"', () => {
  it('错一次：按钮**就在了**（他随时能自己看），但我们不替他打开', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.session!.wrongCounts[0]).toBe(1)
    // 2026-09-22 主人划下的分界，两条缺一不可：
    //   · `canRevealReference` 管**他主动** —— 交过卷就有，不受次数管
    //   · `shouldAutoRevealReference` 管**我们主动** —— 压到错够两次
    // 原来两者是同一个条件，于是"第一次答错"这个状态下解析不给、按钮也没有，
    // 屏幕上只剩一个「下一题」—— 那正是主人报的那个洞。
    expect(quiz.canRevealReference).toBe(true)
    expect(quiz.shouldAutoRevealReference).toBe(false)

    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    expect(quiz.session!.wrongCounts[0]).toBe(2)
    expect(quiz.shouldAutoRevealReference).toBe(true)
  })

  it('**不改代码连点两次「提交」只算一次** —— 不然错一次就会自动弹解析', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    /*
     * 这两下是**真的能点**的：`canSubmit` 对真跑题型的规则是
     * "跑通了、而且不是(已答对且交过)"，答错之后它依然成立（见 store 里的说明）。
     * 所以没有 `firstSubmitOfThisRun` 那道闸的话，连点两下计数就从 0 跳到 2，
     * 参考解在他**只错了一次**的时候就自己弹开了 —— 不报错、不崩溃，
     * 只是这个功能的设计（"让他真的挣扎两轮"）被悄悄拆掉了。
     */
    quiz.submitRun()
    expect(quiz.session!.wrongCounts[0]).toBe(1)
    expect(quiz.shouldAutoRevealReference).toBe(false)
  })

  it('改代码 + 重跑 + 再交 → 才算第二次（"这一轮"由 `checked` 界定）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.submitRun() // 白点
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.submitRun() // 还没重跑 → 交不了，也不该算
    expect(quiz.session!.wrongCounts[0]).toBe(1)

    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    expect(quiz.session!.wrongCounts[0]).toBe(2)
  })

  it('**编译失败不算错** —— 他还没做错任何事，没什么可自动摊开的', () => {
    const quiz = start(codefix())
    quiz.answerCurrent('int main(void){ retrun 0; }')
    quiz.recordRun(runCompileError())
    quiz.submitRun()
    quiz.submitRun()
    expect(quiz.session!.wrongCounts[0]).toBe(0)
    expect(quiz.shouldAutoRevealReference).toBe(false)
    // 按钮也没有 —— 但**不是因为次数不够**，是因为他压根没交上去过
    // （编译失败时 `canSubmit` 是假的，见上面那一节）。要区分开：
    // 将来的回归如果让按钮跟着次数走，这条会红。
    expect(quiz.canRevealReference).toBe(false)
  })

  it('**每题各记各的** —— 第一题错两次，不该把第二题的答案也抖出来', () => {
    const quiz = useQuizStore()
    quiz.startQuiz(
      'lesson',
      'common-12',
      [codefix('q1', '3'), codefix('q2', '3')],
      ['a:q1', 'a:q2']
    )
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    expect(quiz.shouldAutoRevealReference).toBe(true)

    quiz.next()
    expect(quiz.session!.wrongCounts).toEqual([2, 0])
    // 第二题他一眼都还没看，参考解就自己摊开的话 —— 那就是剧透
    expect(quiz.shouldAutoRevealReference).toBe(false)
    expect(quiz.canRevealReference).toBe(false)
  })

  it('**重开一局清零** —— 上一局错两次，这一局不该一进来就带着答案', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    expect(quiz.shouldAutoRevealReference).toBe(true)

    quiz.restart()
    expect(quiz.session!.wrongCounts).toEqual([0])
    expect(quiz.session!.autoRevealed).toEqual([false])
    expect(quiz.shouldAutoRevealReference).toBe(false)
    expect(quiz.canRevealReference).toBe(false)
  })

  it('答对之后按钮**不撤**（用自己那套写法做对的人，最该对照一眼参考解）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("7"); return 0; }')
    quiz.recordRun(runOk('7\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("3"); return 0; }')
    quiz.recordRun(runOk('3\n'))
    expect(quiz.submitRun()).toBe(true)
    expect(quiz.canRevealReference).toBe(true)
  })

  it('同步题型永远不会出现这个按钮（它们没有"参考解"这回事）', () => {
    const quiz = start(choice())
    quiz.answerCurrent(1)
    quiz.submit()
    expect(quiz.canRevealReference).toBe(false)
    expect(quiz.session!.wrongCounts).toEqual([0])
  })
})

describe('自动弹参考解：错够两次，弹一次，然后闭嘴', () => {
  /*
   * 【这个 describe 守的是什么】
   * `shouldAutoRevealReference` 是**推**：不问自答地把参考解摊开。
   * 推错方向的代价不对称 —— 该推不推只是没帮上忙（按钮还在），
   * 不该推乱推就是**每点一次提交都糊一次答案到脸上**。
   * 所以这里逐条钉住"什么时候闭嘴"。
   */

  /** 造一道已经错够两次的题 */
  function wrongTwice() {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    return quiz
  }

  it('错够两次 → 该弹', () => {
    expect(wrongTwice().shouldAutoRevealReference).toBe(true)
  })

  it('**弹过就必须销账** —— 不然他每点一次「提交」都再弹一次', () => {
    const quiz = wrongTwice()
    expect(quiz.shouldAutoRevealReference).toBe(true)

    quiz.ackAutoReveal()
    expect(quiz.session!.autoRevealed[0]).toBe(true)
    expect(quiz.shouldAutoRevealReference).toBe(false)

    /*
     * 再点一次提交（他可能只是想再看看输出）。`wrongCounts` 这时候是 2、
     * 仍然 ≥ 门槛，`checked` 也还是 true —— 两个条件**都还在**。
     * 少了 `autoRevealed` 这一格，参考解就会第二次自己摊开。
     */
    quiz.submitRun()
    expect(quiz.session!.wrongCounts[0]).toBe(2) // ← 白点，计数没动
    expect(quiz.shouldAutoRevealReference).toBe(false)
  })

  it('销账**只销当前这一题** —— 换到下一题，该弹还得弹', () => {
    const quiz = useQuizStore()
    quiz.startQuiz(
      'lesson',
      'common-12',
      [codefix('q1', '3'), codefix('q2', '3')],
      ['a:q1', 'a:q2']
    )
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    quiz.ackAutoReveal()
    expect(quiz.shouldAutoRevealReference).toBe(false)

    quiz.next()
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    // 销账那一下要是写成了会话级布尔（`autoRevealed[0]` 改成整个会话一格），
    // 第二题这里就是 false —— 而它该弹
    expect(quiz.shouldAutoRevealReference).toBe(true)
  })

  it('**答对了不弹** —— 都做出来了还摊答案，是骂人', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'))
    expect(quiz.submitRun()).toBe(true)
    expect(quiz.session!.wrongCounts[0]).toBe(0)
    expect(quiz.shouldAutoRevealReference).toBe(false)
  })

  it('**答对之后又改错** → 只有一次错，还是不弹', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'))
    expect(quiz.submitRun()).toBe(true)
    // 答对那次不进 `wrongCounts`，所以这里是他这道题的**第一次**错
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    expect(quiz.submitRun()).toBe(false)
    expect(quiz.session!.wrongCounts[0]).toBe(1)
    expect(quiz.shouldAutoRevealReference).toBe(false)
    expect(quiz.canRevealReference).toBe(true) // ← 但按钮在（交过卷了）
  })

  it('**改代码之后不弹** —— 他手上是新代码，我们还没看过它', () => {
    const quiz = wrongTwice()
    expect(quiz.shouldAutoRevealReference).toBe(true)

    quiz.answerCurrent('int main(void){ printf("7"); return 0; }')
    expect(quiz.session!.checked[0]).toBe(false)
    expect(quiz.shouldAutoRevealReference).toBe(false)
  })

  it('**编译失败不弹** —— 他还没交上去过，没什么可弹的', () => {
    const quiz = start(codefix())
    quiz.answerCurrent('int main(void){ retrun 0; }')
    quiz.recordRun(runCompileError())
    quiz.submitRun()
    expect(quiz.shouldAutoRevealReference).toBe(false)
  })

  it('同步题型的这一格永远是 false（别让它成了第二条判分路）', () => {
    const quiz = start(choice())
    quiz.answerCurrent(1)
    quiz.submit()
    expect(quiz.shouldAutoRevealReference).toBe(false)
  })

  it('没开局的空 store 上调它 / 调 `ackAutoReveal()` 都不炸', () => {
    const quiz = useQuizStore()
    expect(quiz.shouldAutoRevealReference).toBe(false)
    expect(() => quiz.ackAutoReveal()).not.toThrow()
  })
})

describe('「查看猫咪解析」按钮：交过卷就是他的了', () => {
  /*
   * 【这个 describe 守的是什么】
   * 这是**拉**那条路（2026-09-22 主人要求加的）。它守的是一条
   * 很容易被"顺手优化掉"的规则：**别把它和"错够两次"绑回去**。
   *
   * 绑回去的坏法特别隐蔽：界面看起来完全正常，只有真正卡住的那个人
   * ——那个第一次就想不到怎么写、又不敢乱改的人——才会发现"看答案"的入口不见了。
   * 而他不会有任何报错可以反馈，他只会关掉软件。
   */

  it('**第一次答错就有** —— 卡住的人有权不再试第二次', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.session!.wrongCounts[0]).toBe(1)
    expect(quiz.canRevealReference).toBe(true)
  })

  it('**还没交卷就没有** —— 他还没表态，摆个"看答案"是在催他放弃', () => {
    const quiz = start(codefix('q1', '3'))
    expect(quiz.canRevealReference).toBe(false) // 没跑、没交

    quiz.recordRun(runOk('4\n'))
    expect(quiz.session!.checked[0]).toBe(false)
    expect(quiz.canRevealReference).toBe(false) // 跑完了但没点提交
  })

  it('**改了代码就收回去** —— 它讲的是"我已经交过那一版了"', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.canRevealReference).toBe(true)

    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    // 不收的话，他一改代码就跟前摆着「查看猫咪解析」——
    // 手上那份新代码自己还没试过
    expect(quiz.canRevealReference).toBe(false)
  })

  it('**重开一局收回去**（判据是 `checked`，重开时它被清空）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.canRevealReference).toBe(true)

    quiz.restart()
    expect(quiz.canRevealReference).toBe(false)
  })
})

describe('解析卡：真跑题型要压在「错够两次」后面', () => {
  /*
   * 【这个 describe 守的是什么】
   * 真跑题型的 `explanation` **就是答案本身**（「改成 `i <= 5` 就对了喵～」）。
   * 原来的判据是 `checked[i]` —— 对真跑题型来说答错一次它就亮了，
   * 于是学员**错一次就拿到了答案**，而「先让他自己挣扎一下」那条设计白定了。
   *
   * 这属于"功能还在、设计被绕过去"的坏法：不报错、不崩溃、测试也全绿，
   * 只有真正坐下来做一道题的人才发现"不是说好让自己先想想吗"。
   *
   * ⚠️ 2026-09-22 起它和「查看猫咪解析」按钮**不再共用一道闸**了，别照着
   * "两者必须同时翻面"去写新测试 —— 分界见 store 里 `canShowExplanation`
   * 的注释：这张卡是**我们**先开口，那个按钮是**他**自己开口。
   */
  it('**真跑题型错一次不给解析** —— 给了就等于把答案剧透出去', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.session!.checked[0]).toBe(true) // ← 判分了，旧判据到这里就亮了
    expect(quiz.canShowExplanation).toBe(false) // ← 但解析得压住
  })

  it('错两次给解析 —— 和"自动弹参考解"**同一刻**发生（两个都是我们主动）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    expect(quiz.canShowExplanation).toBe(false)
    // 第一次错的时候按钮**已经在了**，但它不跟着解析一起翻面 ——
    // 这正是 2026-09-22 改的那条分界
    expect(quiz.canRevealReference).toBe(true)

    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    // 这两条必须同时翻面：一个给散文版答案、一个把代码版答案摊开，
    // 差一格就会出现「解析卡出来了、参考解没弹」这种半截状态
    expect(quiz.canShowExplanation).toBe(true)
    expect(quiz.shouldAutoRevealReference).toBe(true)
  })

  it('答对就给 —— 一次没错也讲（做对了还压着不讲才真说不通）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'))
    expect(quiz.canShowExplanation).toBe(false) // 跑完了但还没提交
    expect(quiz.submitRun()).toBe(true)
    expect(quiz.session!.wrongCounts[0]).toBe(0)
    expect(quiz.canShowExplanation).toBe(true)
  })

  it('**编译失败一次都不给** —— 他还没做错任何事，也没什么可讲的', () => {
    const quiz = start(codefix())
    quiz.answerCurrent('int main(void){ retrun 0; }')
    quiz.recordRun(runCompileError())
    quiz.submitRun()
    expect(quiz.canShowExplanation).toBe(false)
  })

  it('改代码之后判定作废 → 解析也跟着收回去（它讲的是已经不存在的代码）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('4\n'))
    quiz.submitRun()
    quiz.answerCurrent('int main(void){ printf("5"); return 0; }')
    quiz.recordRun(runOk('5\n'))
    quiz.submitRun()
    expect(quiz.canShowExplanation).toBe(true)

    quiz.answerCurrent('int main(void){ printf("7"); return 0; }')
    expect(quiz.session!.checked[0]).toBe(false)
    expect(quiz.canShowExplanation).toBe(false)
  })

  it('**其余五个题型一点没被压住** —— 判完就讲（这是它们本来的行为）', () => {
    const quiz = start(choice())
    quiz.answerCurrent(1) // 错的那个
    quiz.submit()
    expect(quiz.session!.checked[0]).toBe(true)
    expect(quiz.canShowExplanation).toBe(true) // ← 不能被新门槛连坐
    expect(quiz.canRevealReference).toBe(false)
  })

  it('没判分之前什么都不给（还没开始答，或跑完没提交）', () => {
    const empty = start(choice())
    expect(empty.canShowExplanation).toBe(false)

    const ran = start(codefix('q1', '3'))
    ran.recordRun(runOk('3\n')) // 跑对了但没点提交
    expect(ran.session!.checked[0]).toBe(false)
    expect(ran.canShowExplanation).toBe(false)
  })
})

describe('分数与重开一局', () => {
  it('`correctCount` 认真跑题型的判定', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-12', [codefix('q1', '3'), choice('q2')], ['a:q1', 'a:q2'])
    quiz.recordRun(runOk('3\n'))
    quiz.submitRun()
    quiz.next()
    quiz.answerCurrent(0)
    quiz.submit()
    expect(quiz.correctCount).toBe(2)
    expect(quiz.verdictAt(0)).toBe(true)
    expect(quiz.verdictAt(1)).toBe(true)
  })

  it('**重开一局丢掉上一局的运行结果** —— 不然新一局一进来就"已经跑过了"', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'))
    quiz.submitRun()
    expect(quiz.session!.runResults[0]).not.toBeNull()

    quiz.restart()
    expect(quiz.session!.runResults).toEqual([null])
    expect(quiz.session!.checked).toEqual([false])
    expect(quiz.canSubmit).toBe(false)
    expect(quiz.verdictAt(0)).toBe(false) // 没跑过 ⇒ 不算对
  })

  it('真跑题和同步题混在一局里，进度和判定互不干扰', () => {
    const quiz = useQuizStore()
    quiz.startQuiz(
      'lesson',
      'common-12',
      [choice('q1'), codefix('q2', '3'), codewrite('q3', '喵')],
      ['a:q1', 'a:q2', 'a:q3']
    )
    quiz.answerCurrent(0)
    quiz.submit()
    expect(quiz.verdictAt(0)).toBe(true)

    quiz.next()
    quiz.recordRun(runOk('3\n'))
    quiz.submitRun()
    quiz.next()
    quiz.recordRun(runOk('汪\n')) // 输出错了
    expect(quiz.submitRun()).toBe(false)

    expect(quiz.correctCount).toBe(2)
    expect(quiz.verdictAt(1)).toBe(true)
    expect(quiz.verdictAt(2)).toBe(false)
  })
})

describe('recordRun：结果必须落在**发起那一题**上（2026-10-14 修）', () => {
  /**
   * 真跑是异步的（真编译，几秒都可能）。而「跑完之前切走」是有路的：
   * 答错交过一次之后按钮排就多出「下一题」，同时「运行」按钮还在
   * （答错了还能改、还能重跑）。重跑期间点「下一题」，`s.index` 就换人了。
   *
   * 旧实现用**完成时刻**的 `s.index` 落账（`s.runResults[s.index] = …`）：
   * 题 0 的输出整份盖到题 1 头上 —— 题 1 凭空"跑通过了"（输出凑巧对上
   * 它的 `expectedOutput` 时还会被放行提交），而真正跑的那一题结果丢了。
   * 全程静默：不抛错、不崩、日志里一个字都没有。
   *
   * 修法：开跑那一刻把题号钉下来（QuizCodeRun 的 `index` prop 快照，
   * 在第一个 `await` 之前），跑完随结果一起交回 —— 这里是 store 这半边的判据。
   */
  it('★ 跑完前点「下一题」：结果落在开跑那一题，下一题一格都不许动', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-12', [codefix('q1', '3'), codefix('q2', '7')], ['a:q1', 'a:q2'])
    // 在题 0 上开跑；跑的过程中界面已经切到题 1
    quiz.next()
    expect(quiz.session!.index).toBe(1)
    // 这一趟运行属于**题 0**（发起时刻的题号随结果一起交回来）
    quiz.recordRun(runOk('3\n'), 0)
    expect(quiz.session!.runResults[0]).not.toBeNull()
    expect(quiz.session!.runResults[1]).toBeNull() // ← 旧实现死在这里：结果整份落在题 1
    expect(quiz.session!.checked[0]).toBe(false)
    expect(quiz.session!.checked[1]).toBe(false)
  })

  it('没带题号的老调用＝记在当前题（同步调用者的语义一分不变）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'))
    expect(quiz.session!.runResults[0]).not.toBeNull()
    expect(quiz.canSubmit).toBe(true)
  })

  it('题号越界 / 指到不真跑的题 → 静默丢弃，不许写错格', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'common-12', [choice('q1'), codefix('q2', '3')], ['a:q1', 'a:q2'])
    quiz.recordRun(runOk('3\n'), 5) // 越界
    quiz.recordRun(runOk('3\n'), -1)
    quiz.recordRun(runOk('3\n'), 0) // 题 0 是选择题：这一趟根本不属于它
    expect(quiz.session!.runResults).toEqual([null, null])
  })
})

describe('recordRun：结果必须属于**发起那一局**（2026-10-14 修·跨局迟到残留）', () => {
  /**
   * 【病灶】上面那组修掉了"同一局里换题号"，但**换局**这条路还开着：
   * 搜索面板点「练相关题」是**不关遮罩、不卸载 QuizCodeRun**就换的局
   * （SearchPanel 的 z-index 9500 压在遮罩 9000 上、Ctrl+K 全局无条件开）。
   * 于是旧局那一趟"还在路上"的运行（真编译，几秒都可能）跑完时，
   * 新局已经就位 —— 旧实现只认题号（`at`），新局同号题照单全收：
   * 学员在新题上什么都没做，输出区却出现了旧题的输出（输出凑巧对上
   * 新题 `expectedOutput` 时还会亮起提交按钮）。全程静默。
   *
   * 修法：`QuizSession` 带**局身份** `sessionId`（startQuiz 时严格递增），
   * `QuizCodeRun` 在开跑那一刻把 `props.sessionId` 与 `props.index`
   * **一起**钉下来（都在第一个 `await` 之前），跑完两份随结果一起交回；
   * `recordRun` 先认局（token）、再认题（at）。
   *
   * 【两层为什么必须都在】token 单独存在时，同局内切题照样串格（上一组
   * 的用例守着）；at 单独存在时，跨局同号照样污染（本组用例守着）。
   * 每组用例里另一层都处于"该放行"状态 —— 被测层必须能**单独**拦住，
   * 这就是本组的种坏自检形态（去掉任一层，本组对应用例立刻红）。
   *
   * 真窗端到端对照：探针 probe-x1（修复前构建上实测到污染落地，修复后
   * 同一探针断言 clean）。
   */
  it('★ 跨局（close 再开新局）：旧局的迟到结果被丢弃，新局一格都不许动', () => {
    const quiz = start(codefix('q1', '3'))
    const tokenA = quiz.session!.sessionId
    quiz.close()
    quiz.startQuiz('lesson', 'common-12', [codefix('q1', '3')], ['common-12:q1'])
    expect(quiz.session!.sessionId).not.toBe(tokenA)
    // 旧局那一趟现在才跑完：同题号（0）、同题型、带着旧局的身份回来
    quiz.recordRun(runOk('3\n'), 0, tokenA)
    expect(quiz.session!.runResults[0]).toBeNull() // ← 旧实现死在这里：整份落进新局
    expect(quiz.canSubmit).toBe(false) // 新题没跑过，提交按钮必须还灰着
  })

  it('★ 跨局（不 close 直接开新局——搜索练题/挑战重开的真实路径）：同样丢弃', () => {
    const quiz = start(codefix('q1', '3'))
    const tokenA = quiz.session!.sessionId
    quiz.startQuiz('lesson', 'common-99', [codefix('q1', '3')], ['common-99:q1'])
    quiz.recordRun(runOk('3\n'), 0, tokenA)
    expect(quiz.session!.runResults[0]).toBeNull()
  })

  it('restart 也换身份：重开一局 = 新局，旧局的迟到结果不许复活', () => {
    const quiz = start(codefix('q1', '3'))
    const tokenA = quiz.session!.sessionId
    quiz.restart()
    expect(quiz.session!.sessionId).not.toBe(tokenA)
    quiz.recordRun(runOk('3\n'), 0, tokenA)
    expect(quiz.session!.runResults[0]).toBeNull()
  })

  it('身份层单独被绕过时，题号层仍拦得住：局对、题号越界 → 丢', () => {
    const quiz = start(codefix('q1', '3'))
    const token = quiz.session!.sessionId // 身份是真的、没过期
    quiz.recordRun(runOk('3\n'), 5, token)
    quiz.recordRun(runOk('3\n'), -1, token)
    expect(quiz.session!.runResults[0]).toBeNull()
  })

  it('带对本局身份的调用正常落账（同局不回归）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'), 0, quiz.session!.sessionId)
    expect(quiz.session!.runResults[0]).not.toBeNull()
    expect(quiz.canSubmit).toBe(true)
  })

  it('缺省 token 的老调用＝记在当前局当前题（同步/测试调用者语义一分不变）', () => {
    const quiz = start(codefix('q1', '3'))
    quiz.recordRun(runOk('3\n'))
    expect(quiz.session!.runResults[0]).not.toBeNull()
  })

  it('局身份严格递增：同进程内绝不回绕、绝不复用', () => {
    const quiz = useQuizStore()
    quiz.startQuiz('lesson', 'a', [codefix('q1', '3')], ['a:q1'])
    const t1 = quiz.session!.sessionId
    quiz.startQuiz('lesson', 'a', [codefix('q1', '3')], ['a:q1'])
    const t2 = quiz.session!.sessionId
    quiz.startQuiz('lesson', 'a', [codefix('q1', '3')], ['a:q1'])
    const t3 = quiz.session!.sessionId
    expect(t2).toBeGreaterThan(t1)
    expect(t3).toBeGreaterThan(t2)
  })
})
