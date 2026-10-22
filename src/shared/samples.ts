/**
 * 练习场的「示例代码」——三个零基础用户上手就能跑的迷你程序。
 *
 * 【为什么要做这个东西】
 * 零基础的人点进练习场，面对一个空白编辑器，最大的障碍不是「不会写语法」，
 * 而是「根本不知道该写什么」。盯着光标闪十秒，然后关掉软件。
 * 所以给三个按钮：点一下代码就填好了，再点「运行」立刻有结果。
 * 第一口吃到了，才有第二口。
 *
 * 【和 content/ 的分工】
 * 课文里的代码样例是**教学内容**，真源在 content/，由内容流水线管。
 * 这里的三个是**界面上手的敲门砖**，跟着按钮和面板一起改，
 * 放 content/ 反而要在两处之间来回对齐，所以留在代码这边。
 *
 * 【这个文件里只有「内容」，没有「文案」】
 * 通篇的中文都是**用户要读的程序源码和它的预期输出**，不是界面文案。
 * 按钮上写什么字、鼠标停上去说什么，在 `copy.ts` 的 `SAMPLE_UI` 里。
 * 这个区分不是洁癖：文案闸门（copy.test.ts）是按文件放行的，
 * 混在一起就只能整份豁免，按钮标签也就跟着失去保护了。
 *
 * 【三个样例为什么选这三个】
 * 打印 → 让用户第一次看见「我写的字变成了程序的输出」；
 * 算数 → 看见「程序会替我做计算」，这是编程有用的最小演示；
 * 输入 → 看见「程序能跟我对话」，这是从玩具变成工具的分界线。
 * 三个都是最常用的入门第一课，四门语言写法一一对应，方便横向对照。
 *
 * ⚠️ 每条都带 expectStdout，是给「自动编译运行校验」用的：本机装好
 * gcc/javac 之后，应当由机器把每条真跑一遍、拿输出和 expectStdout 比对，
 * 对不上就报错。见 __tests__/samples.test.ts 顶部的说明。
 *
 * 【为什么放 shared/ 而不是 renderer/】
 * 因为主进程也要用它：runner 的端到端校验（__tests__/samples-e2e）要拿
 * 同一份代码去真跑，不能自己再抄一份。两个 tsconfig 都包含 src/shared/**，
 * 这是项目里「两边都能用」的既定位置；放 renderer 就得让主进程跨目录去拿，
 * 那是把已经划好的边界捅个洞。
 */
import type { LangOfCode } from './types'

export interface SampleRun {
  code: string
  /** 运行这段代码需要在「输入」框里填的东西；不需要输入就省略 */
  stdin?: string
  /**
   * 这段代码跑完，标准输出应当**一字不差**是这个。
   * 用来给自动化校验比对（换行统一按 \n 记，Windows 的 \r\n 会被规范化掉）。
   */
  expectStdout: string
}

/**
 * 示例的**键**。按钮上的字和说明不在这里——那是界面文案，
 * 真源是 `shared/copy.ts` 的 `SAMPLE_UI`，按这个键去取。
 */
export type SampleKey = 'hello' | 'math' | 'input'

export interface CodeSample {
  key: SampleKey
  byLang: Record<LangOfCode, SampleRun>
}

/** 四门语言里那个「程序从哪开始跑」的入口，写法各不相同，但结构一样 */
export const SAMPLES: readonly CodeSample[] = [
  {
    key: 'hello',
    byLang: {
      python: {
        code: 'print("你好喵～我是咪爱编程！")\n',
        expectStdout: '你好喵～我是咪爱编程！\n'
      },
      c: {
        code: [
          '#include <stdio.h>',
          '',
          'int main() {',
          '    printf("你好喵～我是咪爱编程！\\n");',
          '    return 0;',
          '}',
          ''
        ].join('\n'),
        expectStdout: '你好喵～我是咪爱编程！\n'
      },
      cpp: {
        code: [
          '#include <iostream>',
          'using namespace std;',
          '',
          'int main() {',
          '    cout << "你好喵～我是咪爱编程！" << endl;',
          '    return 0;',
          '}',
          ''
        ].join('\n'),
        expectStdout: '你好喵～我是咪爱编程！\n'
      },
      java: {
        code: [
          'public class Main {',
          '    public static void main(String[] args) {',
          '        System.out.println("你好喵～我是咪爱编程！");',
          '    }',
          '}',
          ''
        ].join('\n'),
        expectStdout: '你好喵～我是咪爱编程！\n'
      }
    }
  },
  {
    key: 'math',
    byLang: {
      python: {
        code: [
          'a = 3',
          'b = 5',
          'print("3 + 5 等于", a + b)',
          'print("3 × 5 等于", a * b)',
          ''
        ].join('\n'),
        expectStdout: '3 + 5 等于 8\n3 × 5 等于 15\n'
      },
      c: {
        code: [
          '#include <stdio.h>',
          '',
          'int main() {',
          '    int a = 3, b = 5;',
          '    printf("3 + 5 等于 %d\\n", a + b);',
          '    printf("3 × 5 等于 %d\\n", a * b);',
          '    return 0;',
          '}',
          ''
        ].join('\n'),
        expectStdout: '3 + 5 等于 8\n3 × 5 等于 15\n'
      },
      cpp: {
        code: [
          '#include <iostream>',
          'using namespace std;',
          '',
          'int main() {',
          '    int a = 3, b = 5;',
          '    cout << "3 + 5 等于 " << a + b << endl;',
          '    cout << "3 × 5 等于 " << a * b << endl;',
          '    return 0;',
          '}',
          ''
        ].join('\n'),
        expectStdout: '3 + 5 等于 8\n3 × 5 等于 15\n'
      },
      java: {
        code: [
          'public class Main {',
          '    public static void main(String[] args) {',
          '        int a = 3, b = 5;',
          '        System.out.println("3 + 5 等于 " + (a + b));',
          '        System.out.println("3 × 5 等于 " + (a * b));',
          '    }',
          '}',
          ''
        ].join('\n'),
        // System.out.println 用的是**平台换行符**，Windows 上是 \r\n。
        // 校验时统一规范化，但这里按 \n 记，因为界面显示出来是一样的。
        expectStdout: '3 + 5 等于 8\n3 × 5 等于 15\n'
      }
    }
  },
  {
    key: 'input',
    byLang: {
      python: {
        code: [
          'n = int(input("请输入一个数字："))',
          'print("它的两倍是", n * 2)',
          ''
        ].join('\n'),
        stdin: '21\n',
        // input() 的提示语是写到标准输出上的（不带换行），所以它和后面的结果连在一行
        expectStdout: '请输入一个数字：它的两倍是 42\n'
      },
      c: {
        code: [
          '#include <stdio.h>',
          '',
          'int main() {',
          '    int n;',
          '    printf("请输入一个数字：");',
          '    scanf("%d", &n);',
          '    printf("它的两倍是 %d\\n", n * 2);',
          '    return 0;',
          '}',
          ''
        ].join('\n'),
        stdin: '21\n',
        expectStdout: '请输入一个数字：它的两倍是 42\n'
      },
      cpp: {
        code: [
          '#include <iostream>',
          'using namespace std;',
          '',
          'int main() {',
          '    int n;',
          '    cout << "请输入一个数字：";',
          '    cin >> n;',
          '    cout << "它的两倍是 " << n * 2 << endl;',
          '    return 0;',
          '}',
          ''
        ].join('\n'),
        stdin: '21\n',
        expectStdout: '请输入一个数字：它的两倍是 42\n'
      },
      java: {
        code: [
          'import java.util.Scanner;',
          '',
          'public class Main {',
          '    public static void main(String[] args) {',
          '        Scanner sc = new Scanner(System.in);',
          '        System.out.print("请输入一个数字：");',
          '        int n = sc.nextInt();',
          '        System.out.println("它的两倍是 " + (n * 2));',
          '    }',
          '}',
          ''
        ].join('\n'),
        stdin: '21\n',
        expectStdout: '请输入一个数字：它的两倍是 42\n'
      }
    }
  }
] as const

/** 按 key 取样例（界面上按钮顺序就按 SAMPLES 原顺序） */
export function sampleByKey(key: SampleKey): CodeSample | undefined {
  return SAMPLES.find((s) => s.key === key)
}

/**
 * 这段代码是不是某条示例的原文（一字未改）？是就返回那条示例，否则 undefined。
 * 跟随规则的两半都靠它：源格命中 = 可跟随；目标格命中（或空着）= 可落笔
 * （目标格里有用户草稿时不许落 —— 见 runner store 的 setLang，2026-10-14 修）。
 */
export function findSampleOf(lang: LangOfCode, code: string): CodeSample | undefined {
  return SAMPLES.find((s) => s.byLang[lang].code === code)
}

/**
 * 换语言时，编辑器里该自动放什么。
 *
 * 【为什么需要这条规则 —— 2026-09-13 主人验收时踩到的】
 * 语言下拉框和编辑器内容本来是两回事：下拉框决定「用哪个编译器」，
 * 编辑器里放的是代码。主人选了 C、点了「打印一句话」，然后把下拉框拨到 Java
 * 直接点运行 —— 应用就拿 C 代码去当 Java 编译，回一句「这段代码里没有 class」；
 * 再拨到 Python 跑，又拿 C 代码当 Python 跑，报 SyntaxError。
 * 从主人的视角看，这软件坏了。
 *
 * 这个坑**不该靠「注意先选语言、再点示例」来绕开** —— 那是把设计缺陷
 * 写进说明书让用户背下来。正确做法是让「选中的语言」和「编辑器里的代码」
 * 在编辑器的代码本来就是示例时自动保持一致。
 *
 * 【规则】只有编辑器里那段**恰好是一条一字未改的示例**时才跟随。
 * 用户自己敲过哪怕一个字符，就绝不替他换 —— 「自动改掉用户写的代码」
 * 是比原 bug 更糟的一种 bug。
 * 本函数只管「源格是不是示例原文」这一半；**目标格要不要让位是调用方的事**
 * （目标格空着、或也只是示例原文才许落笔；有用户草稿就跟不得）。
 *
 * 【为什么连 stdin 一起返回】
 * 示例「让程序问你」需要用户在输入框里填 21。只跟代码不跟输入的话，
 * 换完语言程序会停在等输入上直到超时，用户看到的是「卡住了」——
 * 等于把一个坑换成了另一个坑。
 *
 * @returns 要放进编辑器的东西；null = 不跟随（照常显示目标语言自己那格里的代码）
 */
export function followSample(
  from: LangOfCode,
  to: LangOfCode,
  code: string
): { code: string; stdin: string } | null {
  if (from === to) return null
  const hit = findSampleOf(from, code)
  if (!hit) return null
  const run = hit.byLang[to]
  return { code: run.code, stdin: run.stdin ?? '' }
}
