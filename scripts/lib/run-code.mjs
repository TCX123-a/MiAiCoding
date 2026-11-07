/**
 * 内容管线共用的「真跑一段代码」底座 —— 编译/运行参数与输出解码的**唯一抄写处**。
 *
 * 【为什么要有这个文件】
 * 项目里有两条真跑链路：
 *   · 应用内：`src/main/runner/runner.ts`（学员点「运行」走的就是它）
 *   · 内容侧：`scripts/check-lesson-code.mjs`（验课文里的代码块）
 * 2026-09-15 又多了第三条：`scripts/check-question-code.mjs`（验参考解）。
 * 三条链路跑同一份代码，**参数差一个字，结论就相反** —— 内容侧说「跑得通」，
 * 学员那边却编译失败，而两边看上去都在正常工作。
 *
 * 所以原来长在 `check-lesson-code.mjs` 里的 `LANGS` / `decodeOutput` / `runBlock`
 * 搬到这里，两条内容脚本共用一份。**改这里等于改两条链路**，改之前先读下面的两条铁律。
 *
 * 【两条铁律，抄自 scripts/审计/audit_errorlib.py】
 *   1. 编译/运行参数必须和应用**逐字一致** —— 真源是 `runner.ts` 的 `planForLang()`
 *   2. 输出解码必须和应用**逐字一致** —— 真源是 `runner.ts` 的 `decodeOutput()`
 *      （UTF-8 严格 → GBK 严格 → latin1。javac 的报错按系统本地编码写出来，
 *       中文 Windows 上是 GBK，拿 UTF-8 硬解会把中文全变成问号。）
 *
 * ⚠️ **本文件必须保持「无副作用」**：只导出函数和常量，导入时不碰文件系统、不起进程。
 * 因为 `src/shared/__tests__/run-grading.test.ts` 会 **import 它**来做
 * 「脚本的规范化 == 应用的规范化」的行为比对 —— 那样比读源码文本比对强得多
 * （文本比对拦不住「逻辑抄错了」，只会拦「改了其中一处」）。
 * 一旦这里有了顶层副作用，那条单测就会在跑测试的时候偷偷编译代码。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * 四门语言的**静态**执行计划（Java 的类名要从代码里抠，见 `planForLang`）。
 *
 * 抄自 `runner.ts` 的 `planForLang()`，逐字不改。`src` / `artifact` 这两个字段
 * 应用那边没有（它写文件时直接用 plan 里的 srcFile、判断产物时看文件在不在），
 * 这里留着是给检查脚本报错时用的。
 *
 * ⚠️ 这个表**同时被当成「这门语言跑不跑得了」的判据**用
 * （`check-lesson-code.mjs` 里的 `if (!LANGS[b.lang]) continue`）——
 * 所以键只能增不能减，增的时候记得四条链路都过一遍。
 */
export const LANGS = {
  c: {
    src: 'main.c',
    // -std=gnu11 抄自 runner.ts（2026-09-28）：不写方言，编译器用自己的默认值，
    // 而老编译器默认得很旧（TDM-GCC 4.9.2 = gnu89，`for (int i` 直接编不过）。
    // 理由与实测数字见 runner.ts 那条注释 —— 两边必须一起改，漂了的症状是
    // 「闸门说这道题合格，朋友那台机器上却编不过」。
    compile: ['gcc', '-finput-charset=UTF-8', '-fexec-charset=UTF-8', '-Wall', '-std=gnu11', '-o', 'prog.exe', 'main.c'],
    run: ['./prog.exe'],
    artifact: 'prog.exe'
  },
  cpp: {
    src: 'main.cpp',
    compile: ['g++', '-finput-charset=UTF-8', '-fexec-charset=UTF-8', '-Wall', '-std=gnu++14', '-o', 'prog.exe', 'main.cpp'],
    run: ['./prog.exe'],
    artifact: 'prog.exe'
  },
  java: {
    src: 'Main.java',
    compile: ['javac', '-J-Duser.language=en', '-J-Duser.country=US', '-encoding', 'UTF-8', 'Main.java'],
    run: ['java', '-Duser.language=en', '-Duser.country=US', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', 'Main'],
    artifact: 'Main.class'
  },
  python: {
    src: 'main.py',
    run: ['python', '-X', 'utf8', 'main.py'],
    env: { PYTHONUTF8: '1' }
  }
}

/**
 * 提取 Java 主类名：优先 public class，退回任意 class，都没有返回 null。
 *
 * 抄自 `runner.ts` 的 `findJavaClass()`，**正则必须逐字一致**。
 * 这不是洁癖：`runner.ts` 拿这个类名当**文件名**用（`${cls}.java`），
 * 它抠出来的名字和这里不一样的话，同一个 class 在应用里编得过、在脚本里编不过。
 *
 * 为什么现在才需要它：`check-lesson-code.mjs` 原先写死 `Main.java` ——
 * 课文里的示例**碰巧**全是 `Main`，所以一直没露馅。参考解是 AI 生成的，
 * 类名不受这个巧合保护，写死就会把「类名不叫 Main」报成「跑不起来」。
 *
 * 【有一条单测读两边的源码文本钉住这个正则】（`run-grading.test.ts`）
 */
export function findJavaClass(code) {
  const pub = /public\s+(?:(?:final|abstract|sealed)\s+)*class\s+([A-Za-z_$][\w$]*)/.exec(code)
  if (pub) return pub[1]
  const any = /class\s+([A-Za-z_$][\w$]*)/.exec(code)
  return any ? any[1] : null
}

// ---------------------------------------------------------------------------
// Java 单文件多类拆分（v7 模块六，2026-10-31）—— 抄自 src/shared/java-split.ts
//
// 【为什么脚本也要有】内容侧 `check:lesson-code` / `check:questions` 跑的是
// `.mjs`，进不了 TypeScript。两份实现必须行为一致，否则同一段多类代码
// 「应用里能跑、内容闸门说跑不了」（或反过来）。行为一致性由
// src/shared/__tests__/java-split.test.ts 里跨实现逐例对拍钉住。
// ---------------------------------------------------------------------------

const JAVA_TYPE_KEYWORDS = new Set(['class', 'interface', 'enum', 'record'])
const JAVA_MODIFIERS = new Set([
  'public',
  'protected',
  'private',
  'abstract',
  'final',
  'static',
  'sealed',
  'non-sealed',
  'strictfp',
  'default'
])

function javaIdentChar(ch) {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_' ||
    ch === '$'
  )
}

function javaSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f'
}

/** 注释 / 字符串 / 字符 / 文本块 → 空格（换行与长度保留） */
export function maskJavaLiterals(code) {
  const out = code.split('')
  const n = code.length
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
    }
  }
  let i = 0
  while (i < n) {
    const c = code[i]
    const d = code[i + 1]
    if (c === '/' && d === '/') {
      const start = i
      i += 2
      while (i < n && code[i] !== '\n') i += 1
      blank(start, i)
      continue
    }
    if (c === '/' && d === '*') {
      const start = i
      i += 2
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i += 1
      i = Math.min(n, i + 2)
      blank(start, i)
      continue
    }
    if (c === '"' && d === '"' && code[i + 2] === '"') {
      const start = i
      i += 3
      while (i < n && !(code[i] === '"' && code[i + 1] === '"' && code[i + 2] === '"')) {
        if (code[i] === '\\') i += 2
        else i += 1
      }
      i = Math.min(n, i + 3)
      blank(start, i)
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      const start = i
      i += 1
      while (i < n && code[i] !== quote) {
        if (code[i] === '\\') i += 2
        else i += 1
      }
      i = Math.min(n, i + 1)
      blank(start, i)
      continue
    }
    i += 1
  }
  return out.join('')
}

/**
 * 从「注解名最右一个标识符的左边」往回找限定名链最前面的 `@`（2026-10-31 自检 P2）。
 * 与 src/shared/java-split.ts 的 qualifiedAnnotationAt 逐行为一致。
 */
function javaQualifiedAnnotationAt(masked, k) {
  let i = k
  for (;;) {
    let m = i
    while (m >= 0 && javaSpace(masked[m])) m -= 1
    if (m < 0) return -1
    if (masked[m] === '@') return m
    if (masked[m] !== '.') return -1
    m -= 1
    while (m >= 0 && javaSpace(masked[m])) m -= 1
    while (m >= 0 && javaIdentChar(masked[m])) m -= 1
    i = m
  }
}

function javaDeclarationStart(masked, keywordAt) {
  let at = keywordAt
  for (;;) {
    let j = at - 1
    while (j >= 0 && javaSpace(masked[j])) j -= 1
    if (j < 0) return at
    if (masked[j] === '@') {
      at = j
      continue
    }
    if (masked[j] === ')') {
      let depth = 1
      let k = j - 1
      while (k >= 0 && depth > 0) {
        if (masked[k] === ')') depth += 1
        else if (masked[k] === '(') depth -= 1
        k -= 1
      }
      if (depth !== 0) return at
      while (k >= 0 && javaSpace(masked[k])) k -= 1
      while (k >= 0 && javaIdentChar(masked[k])) k -= 1
      const annoAt = javaQualifiedAnnotationAt(masked, k)
      if (annoAt >= 0) {
        at = annoAt
        continue
      }
      return at
    }
    const nameEnd = j + 1
    while (j >= 0 && javaIdentChar(masked[j])) j -= 1
    const word = masked.slice(j + 1, nameEnd)
    if (word === '') return at
    if (word === 'sealed') {
      // `non-sealed` 是一个修饰符，但连字符把它拆成两个词。
      // 走到这里 j 停在 `sealed` 前面那个字符上 —— 也就是 `-`；
      // `non` 是它左边紧挨着的三个字符（`-` 本身不算），所以窗口是 [k-3, k)。
      const k = j
      if (k >= 3 && masked.slice(k - 3, k) === 'non') {
        at = k - 3
        continue
      }
    }
    if (JAVA_MODIFIERS.has(word)) {
      at = j + 1
      continue
    }
    {
      const annoAt = javaQualifiedAnnotationAt(masked, j)
      if (annoAt >= 0) {
        at = annoAt
        continue
      }
    }
    return at
  }
}

function collectJavaTopLevelTypes(masked) {
  const types = []
  const n = masked.length
  let i = 0
  while (i < n) {
    const ch = masked[i]
    // 顶层注解可能带数组参数（@SuppressWarnings({"a", "b"})），里面的 `{`
    // 会被下面的「顶层花括号 = 不认识」判断误伤 —— 先把整个注解跳过去。
    // `@interface` 不是注解而是类型声明，必须留给下面的类型识别。
    if (ch === '@') {
      let j = i + 1
      while (j < n && javaSpace(masked[j])) j += 1
      const annoStart = j
      while (j < n && javaIdentChar(masked[j])) j += 1
      const annoWord = masked.slice(annoStart, j)
      if (annoWord === 'interface') {
        i += 1
        continue
      }
      // 限定名：@a.b.C
      let k = j
      for (;;) {
        while (k < n && javaSpace(masked[k])) k += 1
        if (masked[k] !== '.') break
        k += 1
        while (k < n && javaSpace(masked[k])) k += 1
        while (k < n && javaIdentChar(masked[k])) k += 1
      }
      if (masked[k] === '(') {
        let depth = 0
        while (k < n) {
          if (masked[k] === '(') depth += 1
          else if (masked[k] === ')') {
            depth -= 1
            if (depth === 0) {
              k += 1
              break
            }
          }
          k += 1
        }
        i = k
      } else {
        i = j
      }
      continue
    }
    if (ch === '{') return []
    if (!javaIdentChar(ch)) {
      i += 1
      continue
    }
    const wordStart = i
    while (i < n && javaIdentChar(masked[i])) i += 1
    const word = masked.slice(wordStart, i)
    if (!JAVA_TYPE_KEYWORDS.has(word)) continue
    let prev = wordStart - 1
    while (prev >= 0 && javaSpace(masked[prev])) prev -= 1
    if (prev >= 0 && masked[prev] === '.') continue
    let j = i
    while (j < n && javaSpace(masked[j])) j += 1
    const nameStart = j
    while (j < n && javaIdentChar(masked[j])) j += 1
    const name = masked.slice(nameStart, j)
    if (name === '' || /^[0-9]/.test(name)) return []
    let bodyStart = -1
    let k = j
    while (k < n) {
      const c = masked[k]
      if (c === '{') {
        bodyStart = k
        break
      }
      if (c === ';' || c === '}') return []
      k += 1
    }
    if (bodyStart === -1) return []
    let depth = 1
    let bodyEnd = bodyStart + 1
    while (bodyEnd < n && depth > 0) {
      if (masked[bodyEnd] === '{') depth += 1
      else if (masked[bodyEnd] === '}') depth -= 1
      bodyEnd += 1
    }
    if (depth !== 0) return []
    const start = javaDeclarationStart(masked, wordStart)
    const modifiers = masked.slice(start, wordStart)
    types.push({
      name,
      isPublic: /(^|\s)public(\s|$)/.test(modifiers),
      start,
      end: bodyEnd,
      masked: masked.slice(start, bodyEnd)
    })
    i = bodyEnd
  }
  return types
}

/**
 * 这个类型体里有没有 main 方法（只用于挑入口；挑错也只是运行期报错，不会写错文件）。
 * 与 src/shared/java-split.ts 的 hasMain 逐行为一致：修饰符顺序不枚举、
 * 参数表必须是 String[] / String...（main() / main(String) 是普通重载）、
 * 嵌套类里的 main 不算（只在花括号深度 1 处认）。
 */
function javaTypeHasMain(type) {
  const masked = type.masked
  const depth = new Int32Array(masked.length + 1)
  let d = 0
  for (let i = 0; i < masked.length; i += 1) {
    depth[i] = d
    if (masked[i] === '{') d += 1
    else if (masked[i] === '}') d -= 1
  }
  depth[masked.length] = d
  const re =
    /\b((?:(?:public|protected|private|static|final|abstract|synchronized|strictfp|native|default)\s+)+)void\s+main\s*\(/g
  const params =
    /^\s*(?:final\s+)?(?:java\s*\.\s*lang\s*\.\s*)?String\s*(?:(?:\[\s*\]|\.\.\.)\s*[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\s*\[\s*\])\s*\)/
  let m
  while ((m = re.exec(masked)) !== null) {
    if (depth[m.index] !== 1) continue
    if (!/(^|\s)public\s/.test(m[1]) || !/(^|\s)static\s/.test(m[1])) continue
    if (!params.test(masked.slice(re.lastIndex))) continue
    return true
  }
  return false
}

/**
 * 与 src/shared/java-split.ts 同行为：≥2 个顶层 public 类型且无 package 才拆。
 * @returns {{plan: {entry: string, files: {file: string, content: string}[]}|null, duplicatePublic?: string}}
 */
export function splitJavaSource(code) {
  const masked = maskJavaLiterals(code)
  const types = collectJavaTopLevelTypes(masked)
  if (types.length === 0) return { plan: null }
  const publics = types.filter((t) => t.isPublic)
  if (publics.length < 2) return { plan: null }
  const firstStart = types[0].start
  if (/(^|\s)package\s+[A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)*\s*;/.test(masked.slice(0, firstStart))) {
    return { plan: null }
  }
  const seen = new Set()
  for (const t of publics) {
    if (seen.has(t.name)) return { plan: null, duplicatePublic: t.name }
    seen.add(t.name)
  }
  const preamble = code.slice(0, firstStart)
  // 入口：public 且带真 main 的 → 任何带真 main 的（包内类也能当入口）→ 第一个 public
  const entryType =
    types.find((t) => t.isPublic && javaTypeHasMain(t)) ?? types.find(javaTypeHasMain) ?? publics[0]
  const others = publics.filter((t) => t !== entryType)
  // 入口自己若是非 public，不能再并进 entryParts 一遍（会重复整段源码）
  const nonPublics = types.filter((t) => !t.isPublic && t !== entryType)
  const entryParts = [preamble, code.slice(entryType.start, entryType.end), ...nonPublics.map((t) => code.slice(t.start, t.end))]
  const files = [
    { file: `${entryType.name}.java`, content: entryParts.join('\n') },
    ...others.map((t) => ({ file: `${t.name}.java`, content: preamble + code.slice(t.start, t.end) }))
  ]
  return { plan: { entry: entryType.name, files } }
}

/**
 * 按语言生成完整的编译/运行计划。抄自 `runner.ts` 的 `planForLang()`。
 *
 * Java 之外的三种语言，计划是静态的；Java 要先从代码里抠出类名 ——
 * 学员写的类叫 `Cat`，就得存成 `Cat.java`、编译 `Cat.java`、运行 `Cat`，
 * 写成 `Main` 的话 javac 直接报「class Cat is public, should be declared in a
 * file named Cat.java」，而那看起来像学员的代码有问题。
 *
 * @returns {{srcFile: string, compile?: string[], run: string[], env?: object, error?: string}}
 *   `error` 是结构级错误（代码里没有 class），调用方应把它当成「编译失败」处理
 */
export function planForLang(lang, code) {
  const base = LANGS[lang]
  if (!base) throw new Error(`没有这门语言的执行计划：${lang}`)
  if (lang !== 'java') {
    return { srcFile: base.src, compile: base.compile, run: base.run, env: base.env }
  }

  // v7 模块六：顶层 public 类 ≥2 时拆分写盘（Person.java + Test.java）。
  // 判定顺序与 runner.ts 逐行一致：先拆、再报重名、最后才是旧的单文件路径。
  const split = splitJavaSource(code)
  if (split.duplicatePublic) {
    return {
      srcFile: `${split.duplicatePublic}.java`,
      run: [],
      // 真源是 shared/copy.ts 的 RUNNER.JAVA_DUPLICATE_CLASS；理由同下面的 NO_JAVA_CLASS
      error: `有两个 public 类都叫「${split.duplicatePublic}」喵～一个类名只能对应一个文件，先把其中一个改个名字再试试吧！`
    }
  }
  if (split.plan) {
    const fileNames = split.plan.files.map((f) => f.file)
    return {
      srcFile: fileNames[0],
      sources: split.plan.files,
      artifact: `${split.plan.entry}.class`,
      compile: [
        'javac',
        '-J-Duser.language=en',
        '-J-Duser.country=US',
        '-encoding',
        'UTF-8',
        ...fileNames
      ],
      run: [
        'java',
        '-Duser.language=en',
        '-Duser.country=US',
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        split.plan.entry
      ]
    }
  }

  const cls = findJavaClass(code)
  if (!cls) {
    return {
      srcFile: 'Main.java',
      run: [],
      // 和 runner.ts 回复学员的是同一句话（真源是 shared/copy.ts 的 RUNNER.NO_JAVA_CLASS）。
      // 这里不 import 那份（.ts 进不来），抄一份字面量 —— 它是**给人看的报错**，
      // 差几个字不影响判断，别为它再加一条闸门。
      error: '这段代码里没有 class 喵～先把类写出来再试一次吧'
    }
  }
  return {
    srcFile: `${cls}.java`,
    // 旧路径的产物名跟着类名走（`Main.class` 只是 LANGS.java 的占位，
    // 类叫 Cat 时真产物是 Cat.class）—— 编译失败的兜底判据要用它。
    artifact: `${cls}.class`,
    compile: [
      'javac',
      '-J-Duser.language=en',
      '-J-Duser.country=US',
      '-encoding',
      'UTF-8',
      `${cls}.java`
    ],
    run: [
      'java',
      '-Duser.language=en',
      '-Duser.country=US',
      '-Dfile.encoding=UTF-8',
      '-Dstdout.encoding=UTF-8',
      cls
    ]
  }
}

/**
 * 抄自 `runner.ts` 的 `decodeOutput()`：UTF-8 严格 → GBK 严格 → latin1，去掉开头 BOM。
 * 逐字不改 —— 解码器不一样的话，同一段 GBK 报错在应用里是中文、在脚本里是问号。
 */
export function decodeOutput(buf) {
  if (!buf || buf.length === 0) return ''
  for (const enc of ['utf8', 'gbk']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf).replace(/^﻿/, '')
    } catch {
      /* 换下一种 */
    }
  }
  return buf.toString('latin1')
}

/**
 * 归一化一份**程序输出** —— `src/shared/run-grading.ts` 的 `normalizeRunOutput()` 的抄写。
 *
 * 这四条不是实现细节，是**内容契约**（`docs/09-内容生成规范.md`「真跑判分的输出比对契约」）：
 *   1. 换行统一：`\r\n` 和孤立的 `\r` 都当作 `\n`
 *   2. 去掉每行的行尾空白（空格和 Tab）
 *   3. 去掉首尾的空行
 *   4. 大小写敏感（靠「什么都不做」实现）
 *
 * ⚠️ 第 1 条是这条链路能不能用的前提：Windows 上四门语言吐出的 stdout 全是 `\r\n`
 * （实测见 `<workspace>/_crlf-probe.mjs`，不随仓库分发），而运行器不剥 `\r`。
 *
 * ⚠️ 故意**不用 `\s+$`**：`\s` 会把全角空格也吃掉，而全角空格在输出里是**内容**。
 *
 * 【两处漂了会怎样】脚本说「参考解合格」，学员在应用里却永远判错 ——
 * 而且两份输出肉眼看一模一样，根本查不出原因。所以 `run-grading.test.ts` 里有一条
 * **行为比对**：把本函数和 `src/shared/run-grading.ts` 的真身喂同一批输入，逐条断言结果相同。
 */
export function normalizeRunOutput(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * 宽松版归一化 —— 抄自 `run-grading.ts` 的 `normalizeRunOutputLoose()`。
 *
 * 2026-10-31 主人反馈「新手多打一个空格不该判错」后新增。判分用
 * 「严格相等 **或** 宽松相等」两档：严格档保住内容契约，宽松档放过
 * 行首/行内多余空格（行与行之间的空行仍然算内容）。
 */
export function normalizeRunOutputLoose(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * 学员跑出来的输出，和内容里写死的 `expectedOutput`，是不是同一份。
 * 抄自 `run-grading.ts` 的 `gradeByRun()` —— 两条链路必须给出同一个判断。
 */
export function gradeByRun(expectedOutput, actualOutput) {
  return (
    normalizeRunOutput(actualOutput) === normalizeRunOutput(expectedOutput) ||
    normalizeRunOutputLoose(actualOutput) === normalizeRunOutputLoose(expectedOutput)
  )
}

/**
 * 把一段代码**真编译真运行**一遍。
 *
 * 【返回值的形状】
 *   `ok`     编译过了、跑完了、正常退出（和应用 `RunResult.ok` 同一个口径）
 *   `phase`  `'compile'` | `'run'` | `'plan'` —— 哪一步倒的
 *   `output` 给人看的那段字：成功时是 stdout，失败时是 stderr+stdout 或结构级错误
 *   `stdout` 解码后的 stdout 原文（**判分只用这个**，和应用的 `RunResult.stdout` 对齐）
 *
 * 【超时】编译 90s、运行 60s，和 `check-lesson-code.mjs` 原来一样。
 * 应用给学生的是「编译 60s + 运行 10s」，这里给得宽 ——
 * 内容侧要拦的是「这份代码根本跑不起来」，不是复刻学员那台机器的负载。
 *
 * 【stdin】应用每次都会写一份 stdin 再关掉（`runner.ts` 的 `child.stdin.write(opts.stdin ?? '')`），
 * 这里用 `execFileSync` 的 `input` 做同一件事：传 undefined 时也照样把管道关掉，
 * 否则读输入的程序会一直等，直到超时。
 *
 * 【产物上限】`execFileSync` 默认 maxBuffer 1MB，超了会抛错并被下面的 catch 接住，
 * 表现是「跑不起来 + ENOBUFS」。参考解正常不会打这么多字，真撞上了也是响的失败，不是静默放行。
 *
 * @param {string} lang  c | cpp | java | python
 * @param {string} code
 * @param {{stdin?: string, timeoutMs?: number, compileTimeoutMs?: number}} [opts]
 */
export function runBlock(lang, code, opts = {}) {
  const plan = planForLang(lang, code)
  if (plan.error) return { ok: false, phase: 'plan', output: plan.error, stdout: '' }

  const dir = mkdtempSync(join(tmpdir(), 'miai-run-'))
  try {
    // v7 模块六：拆分过的 Java 每个类写自己的文件；其余情况仍整段写进 srcFile。
    if (plan.sources) {
      for (const source of plan.sources) writeFileSync(join(dir, source.file), source.content, 'utf8')
    } else {
      writeFileSync(join(dir, plan.srcFile), code, 'utf8')
    }
    const env = { ...process.env, ...(plan.env ?? {}) }
    /*
     * ⚠️ 这一行在 `runner.ts` 里**没有**（应用直接 `{...process.env}`）。留着是刻意的：
     * 本机要是设了 `PYTHONIOENCODING=gbk`，参考解在应用里吐 GBK、在这里吐 UTF-8 ——
     * 内容侧量的是「这份参考解对不对」，不该被本机的环境变量改写结论。
     * 这不是要不要「和应用一致」的问题，是这台机器**不该有**这个变量。
     */
    delete env.PYTHONIOENCODING

    /*
     * ⚠️ 这一条 `runner.ts` 里同样没有 —— 和上面 PYTHONIOENCODING 同源的理由：
     * **闸门的结论不该被本机的代理设置改写**。
     * 2026-10-09 实测：注册表里躺着一条已死的系统代理（HKCU ProxyEnable=1 →
     * http://127.0.0.1:12450，无人监听），课文里所有打 127.0.0.1 的样本就被集体拽红 ——
     * python 的 requests / urllib 在 Windows 上**不看 env 也读注册表**，回环地址照样被劫。
     * 回环本来就不该走代理；把 no_proxy 钉死，这条闸门从此对「本机有没有代理」免疫。
     * 注：本机若设了 http_proxy 且外网真要靠它，钉了 no_proxy 会让样本改走直连 ——
     * 内容样本本来就该是「不碰外网」的，真需要联网的块由课文自己标「需要联网」，不靠代理兜。
     */
    env.no_proxy = '127.0.0.1,localhost,::1'

    if (plan.compile) {
      try {
        execFileSync(plan.compile[0], plan.compile.slice(1), {
          cwd: dir,
          env,
          timeout: opts.compileTimeoutMs ?? 90_000,
          stdio: 'pipe'
        })
      } catch (e) {
        // 编译失败 → 把编译器的话原样带回去，那是学员会看到的同一段字。
        // 但「非零退出」不等于「没编出产物」：gcc 有 warning-as-error 的怪癖，
        // 产物在的话照样往下跑（这一步是从 check-lesson-code.mjs 原样搬来的）。
        const out = `${decodeOutput(e.stderr)}${decodeOutput(e.stdout)}`
        if (!existsSync(join(dir, plan.artifact ?? LANGS[lang].artifact))) {
          return { ok: false, phase: 'compile', output: out, stdout: '' }
        }
      }
    }

    /*
     * C/C++ 的产物是**临时目录里**的 prog.exe，写法 `./prog.exe` —— 必须拼成绝对路径，
     * 否则 spawn 会按 PATH 去找，报 ENOENT（应用那边是 `resolveExe()` 干这件事）。
     * 其余三条（javac / java / python）是**裸命令名**，要的就是走 PATH。
     *
     * ⚠️ 判据是「**以 `./` 开头**」，不是 `isAbsolute()` —— 我第一版写成
     * `isAbsolute(x) ? x : join(dir, x)`，那等于把 `python` 也当成了相对路径，
     * 拼成 `…\Temp\miai-run-xxx\python`。症状是 **Python 和 Java 一律「run 阶段跑不起来」、
     * 输出还是空的**（进程没起来，stderr 自然一个字都没有）——
     * 看上去像"这台机器没装 Python"。这个台子第一次跑自测就撞上了它。
     *
     * 【也就是说：这两条链路的口径本来就不一样，不能"统一"】
     * 应用那边 `run.exe` 拿到的**永远是绝对路径**（工具链路径是探测出来的），
     * 所以它 `isAbsolute ? x : join(cwd, x)` 是对的；这里拿到的可能是裸命令名。
     */
    const cmd = plan.run[0]
    const exe = cmd.startsWith('./') || cmd.startsWith('.\\') ? join(dir, cmd) : cmd
    try {
      const stdout = execFileSync(exe, plan.run.slice(1), {
        cwd: dir,
        env,
        timeout: opts.timeoutMs ?? 60_000,
        stdio: 'pipe',
        input: opts.stdin ?? ''
      })
      return { ok: true, phase: 'run', output: decodeOutput(stdout), stdout: decodeOutput(stdout) }
    } catch (e) {
      const out = `${decodeOutput(e.stdout)}${decodeOutput(e.stderr)}`
      return { ok: false, phase: 'run', output: out, stdout: decodeOutput(e.stdout) }
    }
  } finally {
    /*
     * ⚠️ 这里**必须**吞掉删除失败 —— 与 `runner.ts` 的 finally（`catch {}` + 「残留临时目录
     * 交给系统清理」）保持同一口径。刚 `execFileSync` 起来的子进程退出后，Windows 上
     * 目录句柄偶尔还没放干净（杀软扫描 / 句柄延迟释放），`rmSync` 会抛 EPERM。
     *
     * 2026-09-28 实测：这条没吞的 `rmSync` 让 `npm run check:samples` **整条闸门崩掉**
     * （未捕获异常 → 非零退出），而崩的那一次跑的是一道完全正常的题 ——
     * 一次良性竞态伪装成「闸门红了」。会随机崩的闸门，用的人迟早学会忽略它。
     */
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 残留临时目录交给系统清理
    }
  }
}
