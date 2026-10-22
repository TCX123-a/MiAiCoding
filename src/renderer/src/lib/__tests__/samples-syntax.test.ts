import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { SAMPLES } from '../../../../shared/samples'
import { LANG_OF_CODE } from '../../../../shared/types'
import { SAMPLE_UI } from '../../../../shared/copy'
import { languageExtension } from '../editor-setup'
import type { LangOfCode } from '../../../../shared/types'

/**
 * C / C++ / Java 样例的**语法**闸门。
 *
 * 【为什么需要它】
 * Python 那三条已经在 samples-e2e.test.ts 里真跑过了。剩下 9 条不行：
 * 这台机器没装 gcc/g++/javac（M5 才装）。而这 9 条恰恰是最容易写错的
 * ——手写 C 的花括号、Java 的分号，少一个就是一个编译错误甩在用户脸上。
 *
 * 【用的是什么】
 * CodeMirror 高亮用的 Lezer 解析器本来就支持这三种语言，就在依赖里躺着。
 * 语法不合法时它会在树里插一个「⚠」错误节点，于是不用编译器也能查出
 * 「这对花括号配平了吗」「这句少没少分号」。
 *
 * 【⚠️ 它查不出什么——别高估】
 * 它只做**语法**，不做**语义**。实测确认过：
 *   - 查得出：少右大括号、少分号、括号不配平
 *   - 查不出：printf 拼成 printff（语法上完全合法，只是那个函数不存在）
 * 所以过了这关只代表「能读懂」，不代表「能编译过」。真正的编译验证
 * 得等 M5 工具链就位，用 samples.ts 里那份 expectStdout 去真跑。
 * 这条测试是**漏斗的前半段**，不是替代品。
 *
 * 【为什么放在 renderer 这边】
 * 因为要 import languageExtension()，而它依赖 @codemirror/lang-* 这几个包，
 * 那是渲染进程的依赖。放进 shared 会把这些包拖进主进程的 typecheck。
 */

/** 收集语法树里的错误节点位置 */
function syntaxErrors(code: string, lang: LangOfCode): string[] {
  const state = EditorState.create({ doc: code, extensions: [languageExtension(lang)] })
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state)
  const errs: string[] = []
  tree.cursor().iterate((node) => {
    if (node.type.isError || node.name === '⚠') {
      errs.push(`位置 ${node.from}：…${code.slice(Math.max(0, node.from - 12), node.from)}⟨这里⟩`)
    }
  })
  return errs
}

describe('示例代码的语法检查（Lezer 解析器）', () => {
  it('先证明这个检查器真的会报错——不然下面的「全过」毫无意义', () => {
    // 这是本文件最重要的一条。没有它，哪天 languageExtension 返回了空扩展、
    // 或者解析器 API 变了导致永远拿不到错误节点，下面三条会**假绿**通过，
    // 而我们以为 9 条样例都被盯着。用一个故意写坏的代码当探针钉住这件事。
    const broken = [
      { lang: 'c' as const, code: 'int main() {\n    return 0;\n' }, // 少右大括号
      { lang: 'java' as const, code: 'public class Main {\n    int a = 1\n}\n' } // 少分号
    ]
    for (const b of broken) {
      expect(
        syntaxErrors(b.code, b.lang).length,
        `检查器漏报了 ${b.lang} 的错误——它已经失效了，下面的通过都是假的`
      ).toBeGreaterThan(0)
    }
  })

  it('四种语言的样例代码语法全部合法', () => {
    for (const s of SAMPLES) {
      for (const lang of LANG_OF_CODE) {
        const errs = syntaxErrors(s.byLang[lang].code, lang)
        expect(errs, `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 代码语法有问题：\n${errs.join('\n')}`).toEqual([])
      }
    }
  })

  it('每一门语言都至少有一条样例真的进了这轮检查', () => {
    // 防止「检查列表被清空」这种退化：如果 SAMPLES 变成空数组，
    // 上面那条 for 循环一次都不跑，测试照样绿。
    const checked = new Set<string>()
    for (const s of SAMPLES) {
      for (const lang of LANG_OF_CODE) checked.add(lang)
    }
    expect([...checked].sort()).toEqual([...LANG_OF_CODE].sort())
  })
})
