/**
 * Java 单文件多类拆分（v7 模块六，2026-10-31）。
 *
 * 【为什么需要】课文与练习场里，学员会写 `Person.java` + `Test.java` 两个
 * public 类，但编辑器只有一个输入框。旧运行器只抠「第一个 public 类」，
 * 把整段代码写进 `<第一个类>.java`，javac 看到第二个 public 类立刻报
 * 「class Test is public, should be declared in a file named Test.java」——
 * 学员看起来像是自己写错了，其实是运行器没拆文件。
 *
 * 【怎么拆】只在「顶层 public 类型 ≥ 2」时拆，其余情况**逐字节保持旧行为**
 * （一个 public 类、或没有 public 类的代码，仍然整段写进一个文件）：
 *   · 每个 public 顶层类型各一个 `<类名>.java`；
 *   · package / import 前缀原样复制到每个文件；
 *   · 非 public 顶层类型全部并进入口那个文件（一个文件里只能有一个 public 类，
 *     但可以带任意多个包内类）；
 *   · 入口优先选带 `public static void main(String[])` 的类型（public 优先），
 *     都没有再取第一个 public 类（与旧行为一致）。
 *
 * 【为什么要有自己的扫描器】旧 `findJavaClass` 是纯正则，会命中注释/字符串里的
 * 「public class」，也分不清嵌套类。拆文件要把**真实源码切片**写进多个文件，
 * 切错一个字符就是编译错误，所以这里做一遍轻量词法遮罩：
 * 注释、字符串、字符字面量、文本块全替换成空格（长度不变），再在遮罩上找
 * 顶层的类型声明。遮罩只用于定位，写盘用的仍是原文切片。
 *
 * 【不处理 package】当前运行器在临时目录根部直接 `java 类名`，没有包目录。
 * 带 package 的代码本来就跑不通；这里**不拆**，让 javac 按旧路径报错，
 * 避免把「包路径问题」伪装成「拆分成功了但入口找不到」。
 */

export interface JavaSplitFile {
  /** 文件名（永远是安全的 Java 标识符 + .java） */
  file: string
  /** 这个文件要写的内容（原文切片） */
  content: string
}

export interface JavaSplitPlan {
  /** 入口类名（无 .java） */
  entry: string
  /** 全部要写盘的文件；入口文件排第一 */
  files: JavaSplitFile[]
}

export interface JavaSplitResult {
  /** null = 不需要拆（或拆不了），调用方走旧的单文件路径 */
  plan: JavaSplitPlan | null
  /** 两个顶层 public 类同名：不能各自写一个同名文件，交给调用方报结构错误 */
  duplicatePublic?: string
}

const TYPE_KEYWORDS = new Set(['class', 'interface', 'enum', 'record'])

const MODIFIERS = new Set([
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

/** Java 标识符字符（不用 \w：它不认 $，而 $ 在类名里合法） */
function isIdentChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_' ||
    ch === '$'
  )
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f'
}

/**
 * 把注释 / 字符串 / 字符 / 文本块替换成空格（换行保留，长度不变）。
 *
 * 只用于「找声明位置」，所以不用管遮罩后的内容是否还是合法 Java；
 * 关键是**下标必须与原文一一对应**，下面切原文时才能直接用。
 */
export function maskJavaLiterals(code: string): string {
  const out = code.split('')
  const n = code.length
  const blank = (from: number, to: number): void => {
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
    // 文本块 """…"""：里面可以有普通引号，先于单引号分支处理
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

interface TopLevelType {
  name: string
  isPublic: boolean
  /** 声明起点（含修饰符/注解） */
  start: number
  /** 类型体结束的 `}` 之后一位 */
  end: number
  /** 从 start 到 end 的遮罩切片（找 main 用） */
  masked: string
}

/**
 * 从「注解名最右一个标识符的左边」往回找限定名链最前面的 `@`（2026-10-31 自检 P3）。
 *
 * `@Anno` 传进来时 k 就停在 `@` 上，原样返回；`@java.lang.Anno` 传进来时 k 停在
 * 最后一个标识符左边的 `.` 上，一路跳过 `name(.name)*` 找到最前面的 `@`。
 * 不这么做的话，限定名注解会被截断成「从 public 开始」的声明起点 —— 注解掉进
 * preamble，跟着**每个**生成文件走（本该只属于它标注的那个类），而且一旦注解
 * 不带参数、又落在非首类型上，类型切片和 preamble 就各带半截，拆出来的源码编不过。
 * 不是注解（普通限定名的尾巴）返回 -1。
 */
function qualifiedAnnotationAt(masked: string, k: number): number {
  let i = k
  for (;;) {
    let m = i
    while (m >= 0 && isSpace(masked[m])) m -= 1
    if (m < 0) return -1
    if (masked[m] === '@') return m
    if (masked[m] !== '.') return -1
    m -= 1
    while (m >= 0 && isSpace(masked[m])) m -= 1
    while (m >= 0 && isIdentChar(masked[m])) m -= 1
    i = m
  }
}

/** 从关键字位置向前吃掉修饰符与注解，返回声明起点 */
function declarationStart(masked: string, keywordAt: number): number {
  let at = keywordAt
  for (;;) {
    let j = at - 1
    while (j >= 0 && isSpace(masked[j])) j -= 1
    if (j < 0) return at
    // @interface 的 @ 本身（普通注解的 @ 在名字前面，由下面的标识符分支处理）
    if (masked[j] === '@') {
      at = j
      continue
    }
    // 注解带参数：@Anno(...) —— 从右括号向前配对
    if (masked[j] === ')') {
      let depth = 1
      let k = j - 1
      while (k >= 0 && depth > 0) {
        if (masked[k] === ')') depth += 1
        else if (masked[k] === '(') depth -= 1
        k -= 1
      }
      if (depth !== 0) return at
      while (k >= 0 && isSpace(masked[k])) k -= 1
      while (k >= 0 && isIdentChar(masked[k])) k -= 1
      const annoAt = qualifiedAnnotationAt(masked, k)
      if (annoAt >= 0) {
        at = annoAt
        continue
      }
      return at
    }
    // 普通标识符（修饰符 / 注解名）
    const nameEnd = j + 1
    while (j >= 0 && isIdentChar(masked[j])) j -= 1
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
    if (MODIFIERS.has(word)) {
      at = j + 1
      continue
    }
    {
      // 注解名（可能是限定名 @java.lang.Anno）—— 整个注解都算声明起点
      const annoAt = qualifiedAnnotationAt(masked, j)
      if (annoAt >= 0) {
        at = annoAt
        continue
      }
    }
    return at
  }
}

/** 在遮罩上找出全部顶层类型声明；解析不了就返回空表（调用方回退旧路径） */
function collectTopLevelTypes(masked: string): TopLevelType[] {
  const types: TopLevelType[] = []
  const n = masked.length
  let i = 0
  while (i < n) {
    const ch = masked[i]
    // 顶层注解可能带数组参数（@SuppressWarnings({"a", "b"})），里面的 `{`
    // 会被下面的「顶层花括号 = 不认识」判断误伤 —— 先把整个注解跳过去。
    // `@interface` 不是注解而是类型声明，必须留给下面的类型识别。
    if (ch === '@') {
      let j = i + 1
      while (j < n && isSpace(masked[j])) j += 1
      const annoStart = j
      while (j < n && isIdentChar(masked[j])) j += 1
      const annoWord = masked.slice(annoStart, j)
      if (annoWord === 'interface') {
        i += 1
        continue
      }
      // 限定名：@a.b.C
      let k = j
      for (;;) {
        while (k < n && isSpace(masked[k])) k += 1
        if (masked[k] !== '.') break
        k += 1
        while (k < n && isSpace(masked[k])) k += 1
        while (k < n && isIdentChar(masked[k])) k += 1
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
    if (ch === '{') {
      // 顶层出现花括号但不在类型声明里：不认识的语法，放弃拆分
      return []
    }
    if (!isIdentChar(ch)) {
      i += 1
      continue
    }
    const wordStart = i
    while (i < n && isIdentChar(masked[i])) i += 1
    const word = masked.slice(wordStart, i)
    if (!TYPE_KEYWORDS.has(word)) continue
    // Foo.class 之类：前面紧挨着 '.' 的不是声明
    let prev = wordStart - 1
    while (prev >= 0 && isSpace(masked[prev])) prev -= 1
    if (prev >= 0 && masked[prev] === '.') continue
    // `@interface`：word 是 interface，前面紧挨着 @；它是类型声明，继续
    let j = i
    while (j < n && isSpace(masked[j])) j += 1
    const nameStart = j
    while (j < n && isIdentChar(masked[j])) j += 1
    const name = masked.slice(nameStart, j)
    if (name === '' || /^[0-9]/.test(name)) return []
    // 找类型体的开括号（泛型、extends/implements、record 组件都在它之前）
    let bodyStart = -1
    let k = j
    while (k < n) {
      const c = masked[k]
      if (c === '{') {
        bodyStart = k
        break
      }
      // 顶层类型头里出现分号：不是类型声明（比如注解参数里的怪东西），放弃
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
    const start = declarationStart(masked, wordStart)
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
 *
 * 三个细节：
 *   · 修饰符顺序不枚举（`public static final void` / `final public static void` 都合法），
 *     而是把 `void main(` 前面的修饰符串整段抓下来，再检查包里同时有 public 和 static；
 *   · 参数表必须是 `String[]` / `String...`（也认 C 风格 `String args[]`）——
 *     `main()` / `main(String)` 是普通重载，Java 启动器根本不会当入口
 *     （2026-10-31 自检 P2：旧实现只认方法名，会把入口挑到错类上）；
 *   · 嵌套类里的 main 不算（Java 启动器也不会去找 `Outer$Inner.main`），
 *     所以只在花括号深度 1 处认。
 */
function hasMain(type: TopLevelType): boolean {
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
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    if (depth[m.index] !== 1) continue
    if (!/(^|\s)public\s/.test(m[1]) || !/(^|\s)static\s/.test(m[1])) continue
    // re.lastIndex 停在 `main (` 之后：参数表不对就不是入口签名
    if (!params.test(masked.slice(re.lastIndex))) continue
    return true
  }
  return false
}

/**
 * 拆分 Java 源码。只有「≥2 个顶层 public 类型」且没有 package 声明时才拆；
 * 其余情况返回 `{ plan: null }`，调用方必须走旧路径（不是「失败」，是「不需要」）。
 */
export function splitJavaSource(code: string): JavaSplitResult {
  const masked = maskJavaLiterals(code)
  const types = collectTopLevelTypes(masked)
  if (types.length === 0) return { plan: null }
  const publics = types.filter((t) => t.isPublic)
  if (publics.length < 2) return { plan: null }

  // package 声明（旧运行器不建包目录，拆了也跑不起来）：不拆
  const firstStart = types[0].start
  if (/(^|\s)package\s+[A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)*\s*;/.test(masked.slice(0, firstStart))) {
    return { plan: null }
  }

  const seen = new Set<string>()
  for (const t of publics) {
    if (seen.has(t.name)) return { plan: null, duplicatePublic: t.name }
    seen.add(t.name)
  }

  const preamble = code.slice(0, firstStart)
  /*
   * 【2026-10-31 自检 P2】入口不能只在 public 类型里找：`class M { public static
   * void main(String[] a) }` 是合法的启动入口（默认包、包内类），旧实现会忽略它、
   * 把第一个 public 类当入口 —— `java A` 立刻报 Main method not found。
   * 顺序：public 且带真 main 的 → 任何带真 main 的 → 第一个 public（旧行为兜底）。
   */
  const entryType =
    types.find((t) => t.isPublic && hasMain(t)) ?? types.find(hasMain) ?? publics[0]
  const others = publics.filter((t) => t !== entryType)
  // 入口自己若是非 public，不能再并进 entryParts 一遍（会重复整段源码）
  const nonPublics = types.filter((t) => !t.isPublic && t !== entryType)

  const entryParts = [preamble, code.slice(entryType.start, entryType.end), ...nonPublics.map((t) => code.slice(t.start, t.end))]
  const files: JavaSplitFile[] = [
    { file: `${entryType.name}.java`, content: entryParts.join('\n') },
    ...others.map((t) => ({ file: `${t.name}.java`, content: preamble + code.slice(t.start, t.end) }))
  ]
  return { plan: { entry: entryType.name, files } }
}
