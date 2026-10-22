import { describe, expect, it } from 'vitest'
import {
  gradeChoice,
  gradeCode,
  gradeCodeFill,
  gradeCodeFillBlanks,
  gradeFill,
  gradeQuestion,
  isAnswered,
  isMultilineCodeAnswer,
  normalizeFill,
  normalizeCode
} from '../quiz-grading'
import type { CodeFillQuestion, Question } from '../types'

describe('gradeChoice 选择判分', () => {
  it('下标相等才正确', () => {
    expect(gradeChoice(1, 1)).toBe(true)
    expect(gradeChoice(2, 1)).toBe(false)
    expect(gradeChoice(null, 0)).toBe(false)
  })
})

describe('normalizeFill 填空归一化', () => {
  it('去两端空白、折叠内部空白、小写化', () => {
    expect(normalizeFill('  Hello   World ')).toBe('hello world')
  })
  it('中文不受影响', () => {
    expect(normalizeFill(' 小鱼干 ')).toBe('小鱼干')
  })
})

describe('gradeFill 填空判分', () => {
  it('空白容忍 + 大小写不敏感', () => {
    expect(gradeFill('  PRINT ', 'print')).toBe(true)
    expect(gradeFill('print', 'PRINT')).toBe(true)
  })
  it('accept 等价答案生效', () => {
    expect(gradeFill('printf', 'print', ['printf'])).toBe(true)
    expect(gradeFill('echo', 'print', ['printf'])).toBe(false)
  })
  it('空作答判错', () => {
    expect(gradeFill('   ', 'print')).toBe(false)
  })
})

describe('normalizeCode 代码输出归一化', () => {
  it('去行尾空白与首尾空行，保留内部换行与大小写', () => {
    expect(normalizeCode('\nHello World  \n\n')).toBe('Hello World')
    expect(normalizeCode('A\n  B  \n')).toBe('A\n  B')
    expect(normalizeCode('Hello')).toBe('Hello') // 大小写保留
  })

  /**
   * 【这条是"学员写对了却判错"那类 bug 的守门员】
   *
   * 这道题的答案在内容里是手写的（LF），而学员要么用 Windows 的输入法、
   * 要么从别处粘一段过来，拿到的是 `\r\n`。从前这一格是错的：
   * 去掉行尾空白用的是 `[ \t]+$`，`\r` 不在里面，于是 `"3\r\n"` 归一成 `"3\r"`，
   * 和答案 `"3"` **不相等** —— 而两份答案摆在屏幕上一模一样，谁也看不出差在哪。
   */
  it('CRLF 与孤立的 CR 都当换行 —— Windows 上粘过来也是同一个答案', () => {
    expect(normalizeCode('3\r\n')).toBe('3')
    expect(normalizeCode('a\r\nb')).toBe('a\nb')
    expect(normalizeCode('a\rb')).toBe('a\nb')
  })
})

describe('gradeCode 代码题判分', () => {
  it('行尾空白与末尾空行不扣分', () => {
    expect(gradeCode('hello\n', 'hello')).toBe(true)
    expect(gradeCode('hello  ', 'hello')).toBe(true)
  })
  it('大小写敏感', () => {
    expect(gradeCode('Hello', 'hello')).toBe(false)
  })
  it('accept 生效', () => {
    expect(gradeCode('done', 'yes', ['done'])).toBe(true)
  })
  it('**多行答案**：粘贴的 CRLF 判对，中间那行空行不算多也不算少', () => {
    expect(gradeCode('1\r\n2\r\n3', '1\n2\n3')).toBe(true)
    expect(gradeCode('1\n\n2', '1\n2')).toBe(false) // 中间空行是内容，不能吞
    expect(gradeCode('1\n2', '1\n2\n3')).toBe(false) // 少打一行就是错的
  })
  it('只打了换行不算作答（空作答判错那条对多行同样成立）', () => {
    expect(gradeCode('\r\n', 'x')).toBe(false)
    expect(gradeCode('\n\n', 'x')).toBe(false)
  })
})

describe('isMultilineCodeAnswer 答题界面该用单行框还是多行框', () => {
  it('答案真有好几行 → 多行', () => {
    expect(isMultilineCodeAnswer('小\n链\n鱼干')).toBe(true)
    expect(isMultilineCodeAnswer('1\n2\n3')).toBe(true)
    expect(isMultilineCodeAnswer('a\n\nb')).toBe(true) // 中间空行也算内容
  })

  it('一行 → 单行', () => {
    expect(isMultilineCodeAnswer('1 + 1')).toBe(false)
    expect(isMultilineCodeAnswer('   ')).toBe(false)
  })

  /**
   * 【这条是 2026-09-15 在真窗口里翻的车，不是想象出来的边界】
   *
   * `accept` 里挂一条 `"…\n"` 是**末尾换行的容忍写法**（内容侧的常见习惯），
   * 不是"这道题答案有好几行"。第一版判据直接 `includes('\n')`，
   * 于是 `python-stage1-01 q7`（答案 `"1 + 1"`，一行）被渲染成了**多行框** ——
   * 单行题白白多点了一次回车，学员按老习惯敲回车却只换行、不交卷。
   * 真窗口那一趟（`_e2e-multiline-code.mjs` 的 B 组）就是专门抓这个的。
   */
  it('**末尾换行不算"好几行"** —— 归一化之后还有换行才算', () => {
    expect(isMultilineCodeAnswer('1 + 1\n')).toBe(false)
    expect(isMultilineCodeAnswer('1 + 1\r\n')).toBe(false)
    expect(isMultilineCodeAnswer('\n1 + 1\n\n')).toBe(false)
  })

  it('accept 里同一条规则：末尾换行不算，中间换行算', () => {
    expect(isMultilineCodeAnswer('1 + 1', ['1 + 1\n'])).toBe(false)
    expect(isMultilineCodeAnswer('a', ['a\nb'])).toBe(true)
  })
})

describe('gradeQuestion 分发', () => {
  const choiceQ: Question = {
    id: 'q1',
    type: 'choice',
    stem: '1+1=?',
    options: ['1', '2'],
    answer: 1,
    explanation: 'x'
  }
  const fillQ: Question = {
    id: 'q2',
    type: 'fill',
    stem: 'print 函数的作用是____',
    answer: '输出',
    explanation: 'x'
  }
  const codeQ: Question = {
    id: 'q3',
    type: 'code',
    lang: 'python',
    code: 'print("hi")',
    stem: '输出什么？',
    answer: 'hi',
    explanation: 'x'
  }
  const codeFillQ: Question = {
    id: 'q4',
    type: 'codefill',
    lang: 'python',
    code: 'total = ____(____)',
    stem: '补完整喵',
    blanks: [{ answer: 'int' }, { answer: 'sum' }],
    explanation: 'x'
  }

  it('按题型分发到对应判分器', () => {
    expect(gradeQuestion(choiceQ, 1)).toBe(true)
    expect(gradeQuestion(choiceQ, 0)).toBe(false)
    expect(gradeQuestion(fillQ, ' 输出 ')).toBe(true)
    expect(gradeQuestion(fillQ, '输入')).toBe(false)
    expect(gradeQuestion(codeQ, 'hi\n')).toBe(true)
    expect(gradeQuestion(codeQ, 'HI')).toBe(false)
    expect(gradeQuestion(choiceQ, null)).toBe(false)
  })

  it('codefill 也在这条链路上（不是只有三个老题型）', () => {
    expect(gradeQuestion(codeFillQ, 'int\nsum')).toBe(true)
    expect(gradeQuestion(codeFillQ, 'int\nsub')).toBe(false)
  })

  /**
   * 【这条守的是 `gradeQuestion` 那个没有 `default` 的 switch】
   *
   * 加新题型时最容易干的事是随手写个 `default: return false`（"未知的先判错"），
   * 于是新题型**永远判错**，而 `typecheck` 一声不吭 —— 它恰恰是在
   * "少写一个 case 就不返回值"报错的，加了 default 就没有这个保护了。
   *
   * 所以这里遍历**每一种题型**，断言拿到的是一个真正的 `boolean`。
   * 将来加了 `codefix` 忘了接判分，只要它是 `undefined`，这条就红。
   * （它拦不住 `default: return false` 这种"判错但类型对"的写法 ——
   *   那种只能靠 review，所以上面那句注释把理由写在这儿。）
   */
  it('每一种题型都有判分分支，没有哪个落到 undefined 上', () => {
    for (const q of [choiceQ, fillQ, codeQ, codeFillQ]) {
      expect(typeof gradeQuestion(q, 0)).toBe('boolean')
      expect(typeof gradeQuestion(q, 'x')).toBe('boolean')
    }
  })
})

describe('gradeQuestion 分发：codefill', () => {
  const q: CodeFillQuestion = {
    id: 'q9',
    type: 'codefill',
    lang: 'python',
    code: 'for i in range(____):\n    total ____ i',
    stem: '把这段程序补完整喵',
    blanks: [{ answer: '3' }, { answer: '+=' }],
    explanation: 'x'
  }

  it('每个空都填对才算对', () => {
    expect(gradeCodeFill('3\n+=', q)).toBe(true)
    expect(gradeCodeFill('3\n-=', q)).toBe(false)
    expect(gradeCodeFill('4\n+=', q)).toBe(false)
  })

  it('**空位顺序不能串** —— 把两个答案对调要判错', () => {
    // 这条比它看上去重要：空位之间没有任何东西区分彼此，只有**位置**。
    // 顺序要是没对上，学员"每个空都填对了"却得零分，而看自己的答案完全正常。
    expect(gradeCodeFill('+=\n3', q)).toBe(false)
  })

  it('复用 fill 的归一规则：大小写不敏感、容忍两端空白', () => {
    const q2: CodeFillQuestion = { ...q, code: '____', blanks: [{ answer: 'Print' }] }
    expect(gradeCodeFill('  print ', q2)).toBe(true)
  })

  it('每个空各认各的 accept', () => {
    const q3: CodeFillQuestion = {
      ...q,
      code: '____',
      blanks: [{ answer: 'range(3)', accept: ['range(0,3)', 'range(0, 3)'] }]
    }
    expect(gradeCodeFill('range(0,3)', q3)).toBe(true)
    expect(gradeCodeFill('range(1,4)', q3)).toBe(false)
  })

  it('缺的空按"空着"算，判错（不是"少比一个"）', () => {
    // 少填的空不能被跳过 —— 跳过的意思是"这题只答一半也算对"
    expect(gradeCodeFill('3\n', q)).toBe(false)
    expect(gradeCodeFill('3', q)).toBe(false)
    expect(gradeCodeFill('', q)).toBe(false)
  })

  it('逐空判分返回每个空的对错，长度等于空位数', () => {
    expect(gradeCodeFillBlanks('3\n-=', q)).toEqual([true, false])
    expect(gradeCodeFillBlanks('__错的__\n__错的__', q)).toEqual([false, false])
    expect(gradeCodeFillBlanks('', q)).toEqual([false, false])
  })

  it('**空位为 0 的题判错，不是判对**', () => {
    // `[].every()` 是 `true`。照直写的话，一道没有空位的坏题会变成"人人都答对" ——
    // 而它恰恰是内容出错时最可能出现的形状（挖空忘了写）。
    const broken: CodeFillQuestion = { ...q, code: 'print(1)', blanks: [] }
    expect(gradeCodeFill('', broken)).toBe(false)
  })
})

describe('isAnswered 够不够格提交', () => {
  it('三个老题型的行为**一字未改**：非空即可交', () => {
    const choiceQ: Question = { id: 'a', type: 'choice', stem: 's', options: ['甲', '乙'], answer: 0, explanation: 'x' }
    const fillQ: Question = { id: 'b', type: 'fill', stem: 's', answer: '甲', explanation: 'x' }
    // 选择题选 0（下标 0 也是个值，不能因为 `0` falsy 就被挡）
    expect(isAnswered(choiceQ, 0)).toBe(true)
    expect(isAnswered(fillQ, '甲')).toBe(true)
    expect(isAnswered(fillQ, '   ')).toBe(false)
    expect(isAnswered(fillQ, null)).toBe(false)
  })

  it('codefill：只填了一个空 → **不能提交**（这是它唯一的额外规则）', () => {
    // 【为什么这条必须存在】只填第一个空时那一串是 `"int\n\n"`，**非空** ——
    // 照老规则就能交。而交完之后输入框立刻锁上（readonly），
    // 学员剩下两个空**再也填不进去**，这道题当场作废。
    const q: CodeFillQuestion = {
      id: 'c',
      type: 'codefill',
      lang: 'python',
      code: '____ ____',
      stem: 's',
      blanks: [{ answer: 'a' }, { answer: 'b' }],
      explanation: 'x'
    }
    expect(isAnswered(q, 'a\nb')).toBe(true)
    expect(isAnswered(q, 'a\n')).toBe(false)
    expect(isAnswered(q, '\nb')).toBe(false)
    expect(isAnswered(q, '   \nb')).toBe(false) // 只敲了空格不算填
    expect(isAnswered(q, '')).toBe(false)
    expect(isAnswered(q, null)).toBe(false)
  })

  it('codefill：给的要不是字符串（上游串了类型）→ 判不能交，不抛错', () => {
    const q: CodeFillQuestion = {
      id: 'd',
      type: 'codefill',
      lang: 'c',
      code: '____',
      stem: 's',
      blanks: [{ answer: 'x' }],
      explanation: 'x'
    }
    expect(isAnswered(q, 3)).toBe(false)
  })
})
